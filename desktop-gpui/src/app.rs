//! Root view: restore → sign-in (email magic link or pasted link) → devices.
//! Copy and behavior follow `src/App.tsx` and `src/components/Login.tsx`.

use std::time::Duration;

use gpui::{
    div, prelude::*, px, AnyElement, ClipboardItem, Context, Div, Entity, Focusable, FontWeight, SharedString,
    Stateful, Subscription, Task, Window,
};

use crate::{
    account::{self, ApiError, Auth, Device},
    connection::{Connection, SessionStatus, Status},
    qr, store,
    text_input::{Submitted, TextInput},
    theme,
};

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    SignIn,
    SignUp,
}

enum Screen {
    Restoring,
    SignIn,
    Workspace,
}

pub struct MacRemote {
    screen: Screen,
    // Sign-in
    mode: Mode,
    email: Entity<TextInput>,
    link: Entity<TextInput>,
    server: Entity<TextInput>,
    show_server: bool,
    mail_ready: Option<bool>,
    checked_server: String,
    sent: bool,
    sent_email: String,
    cooldown: u32,
    paste_link: bool,
    busy: bool,
    error: Option<String>,
    config_task: Option<Task<()>>,
    cooldown_task: Option<Task<()>>,
    // Workspace
    auth: Option<Auth>,
    connection: Option<Entity<Connection>>,
    connection_subscription: Option<Subscription>,
    /// Phone awaiting revoke confirmation.
    revoke_id: Option<String>,
    copy_status: String,
    /// "Skip approval for" choice on the current request, and which request it belongs to.
    remember_ms: i64,
    remember_request: String,
    update: Option<crate::update::Update>,
    update_dismissed: String,
    update_task: Option<Task<()>>,
    /// e2e builds only: synthetic capture for the test harness.
    test_mode: bool,
    account_error: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl MacRemote {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let email = cx.new(|cx| TextInput::new(cx, "you@example.com", 254));
        let link = cx.new(|cx| TextInput::new(cx, "https://enftify.com/#sign-in=…", 4096));
        let server = cx.new(|cx| TextInput::new(cx, account::PRODUCTION_SERVICE, 512));
        let initial_server = store::saved_server().map(|s| account::canonical_service(&s)).unwrap_or_else(|| account::PRODUCTION_SERVICE.into());
        server.update(cx, |input, cx| input.set_text(initial_server.clone(), cx));

        let subscriptions = vec![
            cx.subscribe_in(&email, window, |this, _, _: &Submitted, window, cx| this.submit(window, cx)),
            cx.subscribe_in(&link, window, |this, _, _: &Submitted, window, cx| this.submit(window, cx)),
            cx.subscribe_in(&server, window, |this, _, _: &Submitted, window, cx| this.submit(window, cx)),
            // Typing a different email clears the "sent" state and resend cooldown.
            cx.observe(&email, |this, email, cx| {
                let value = email.read(cx).text();
                if !this.confirming() && this.sent && value != this.sent_email {
                    this.sent = false;
                    this.cooldown = 0;
                    this.cooldown_task = None;
                    cx.notify();
                }
            }),
            // Re-check email sign-in availability when the server changes (debounced like Login.tsx).
            cx.observe(&server, |this, server, cx| {
                let value = server.read(cx).text();
                if value != this.checked_server {
                    this.check_config(cx);
                }
            }),
        ];

        let mut this = Self {
            screen: Screen::Restoring,
            mode: Mode::SignIn,
            email,
            link,
            server,
            show_server: false,
            mail_ready: None,
            checked_server: String::new(),
            sent: false,
            sent_email: String::new(),
            cooldown: 0,
            paste_link: false,
            busy: false,
            error: None,
            config_task: None,
            cooldown_task: None,
            auth: None,
            connection: None,
            connection_subscription: None,
            revoke_id: None,
            copy_status: String::new(),
            remember_ms: 0,
            remember_request: String::new(),
            update: None,
            update_dismissed: store::dismissed_update(),
            update_task: None,
            test_mode: false,
            account_error: None,
            _subscriptions: subscriptions,
        };
        this.watch_updates(cx);
        #[cfg(feature = "e2e")]
        if let Some(config) = crate::e2e::config() {
            this.test_mode = true;
            this.restore_token(config.server, config.token, cx);
            return this;
        }
        this.restore(initial_server, cx);
        this
    }

    #[cfg(feature = "e2e")]
    pub fn connection_for_tests(&self) -> Option<Entity<Connection>> {
        self.connection.clone()
    }

    /// e2e only: sign in with a given token, bypassing the Keychain login.
    #[cfg(feature = "e2e")]
    fn restore_token(&mut self, service: String, token: String, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            let result = cx.background_executor().spawn(async move { account::restore(&service, &token) }).await;
            this.update(cx, |this, cx| match result {
                Ok(auth) => this.enter_workspace(auth, cx),
                Err(err) => this.enter_sign_in(Some(err.to_string()), cx),
            })
            .ok();
        })
        .detach();
    }

    fn confirming(&self) -> bool {
        self.paste_link
    }

    // ---------- Restore ----------

    fn restore(&mut self, service: String, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let Some(saved) = store::load_session(&service)? else { return Ok(None) };
                    match account::restore(&service, &saved.token) {
                        Ok(auth) => Ok(Some(auth)),
                        Err(err) if ApiError::is_unauthorized(&err) => {
                            store::clear_session(&service)?;
                            Ok(None)
                        }
                        Err(err) => Err(err),
                    }
                })
                .await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(Some(auth)) => this.enter_workspace(auth, cx),
                    Ok(None) => this.enter_sign_in(None, cx),
                    Err(err) => this.enter_sign_in(Some(err.to_string()), cx),
                }
            })
            .ok();
        })
        .detach();
    }

    fn enter_sign_in(&mut self, error: Option<String>, cx: &mut Context<Self>) {
        self.screen = Screen::SignIn;
        self.auth = None;
        self.close_connection(cx);
        self.error = error;
        self.busy = false;
        self.paste_link = false;
        self.link.update(cx, |input, cx| input.set_text("", cx));
        self.check_config(cx);
        cx.notify();
    }

    fn enter_workspace(&mut self, auth: Auth, cx: &mut Context<Self>) {
        self.screen = Screen::Workspace;
        self.auth = Some(auth.clone());
        self.account_error = None;
        self.error = None;
        self.revoke_id = None;
        self.close_connection(cx);
        let connection = cx.new(|cx| Connection::new(auth, self.test_mode, cx));
        self.connection_subscription = Some(cx.observe(&connection, |_, _, cx| cx.notify()));
        self.connection = Some(connection);
        cx.notify();
    }

    fn close_connection(&mut self, cx: &mut Context<Self>) {
        if let Some(connection) = self.connection.take() {
            connection.update(cx, |connection, cx| connection.dispose(cx));
        }
        self.connection_subscription = None;
    }

    // ---------- Sign-in ----------

    fn check_config(&mut self, cx: &mut Context<Self>) {
        let raw = self.server.read(cx).text();
        self.checked_server = raw.clone();
        self.mail_ready = None;
        cx.notify();
        self.config_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(250)).await;
            let ready = cx
                .background_executor()
                .spawn(async move { account::service_url(&raw).map(|s| account::magic_link_available(&s)).unwrap_or(false) })
                .await;
            this.update(cx, |this, cx| {
                this.mail_ready = Some(ready);
                cx.notify();
            })
            .ok();
        }));
    }

    fn submit(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        if self.busy || !matches!(self.screen, Screen::SignIn) {
            return;
        }
        let email = self.email.read(cx).text().trim().to_string();
        let link = self.link.read(cx).text();
        let confirming = self.confirming();
        if email.is_empty() || (confirming && link.trim().is_empty()) || (!confirming && (self.mail_ready != Some(true) || self.cooldown > 0)) {
            return;
        }
        let service = match account::service_url(&self.server.read(cx).text()) {
            Ok(service) => service,
            Err(err) => {
                self.error = Some(err.to_string());
                cx.notify();
                return;
            }
        };
        self.busy = true;
        self.error = None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            if confirming {
                let result = cx
                    .background_executor()
                    .spawn(async move {
                        let token = account::sign_in_link_token(&link, &service)?;
                        let auth = account::verify_link(&service, &token, &email)?;
                        store::save_session(&auth.service, &auth.token, auth.expires)?;
                        store::remember_server(&auth.service);
                        Ok::<_, anyhow::Error>(auth)
                    })
                    .await;
                this.update(cx, |this, cx| {
                    this.busy = false;
                    match result {
                        Ok(auth) => this.enter_workspace(auth, cx),
                        Err(err) => this.error = Some(err.to_string()),
                    }
                    cx.notify();
                })
                .ok();
            } else {
                let sent_to = email.clone();
                let result = cx.background_executor().spawn(async move { account::send_magic_link(&service, &email) }).await;
                this.update(cx, |this, cx| {
                    this.busy = false;
                    match result {
                        Ok(()) => {
                            this.sent = true;
                            this.sent_email = sent_to;
                            this.start_cooldown(cx);
                        }
                        Err(err) => this.error = Some(err.to_string()),
                    }
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn start_cooldown(&mut self, cx: &mut Context<Self>) {
        self.cooldown = 60;
        self.cooldown_task = Some(cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            let more = this
                .update(cx, |this, cx| {
                    this.cooldown = this.cooldown.saturating_sub(1);
                    cx.notify();
                    this.cooldown > 0
                })
                .unwrap_or(false);
            if !more {
                break;
            }
        }));
    }

    fn toggle_paste_link(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.paste_link = !self.paste_link;
        self.error = None;
        self.link.update(cx, |input, cx| input.set_text("", cx));
        if self.paste_link {
            self.link.read(cx).focus_handle(cx).focus(window);
        }
        cx.notify();
    }

    // ---------- Workspace ----------

    fn sign_out(&mut self, cx: &mut Context<Self>) {
        let Some(auth) = self.auth.clone() else { return };
        self.busy = true;
        // Signing out stops skipping approval for every phone, as in the Electron app.
        if let Some(connection) = &self.connection {
            connection.update(cx, |c, _| c.forget_remembered(None));
        }
        self.close_connection(cx);
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    account::logout(&auth)?;
                    store::clear_session(&auth.service)
                })
                .await;
            this.update(cx, |this, cx| {
                this.busy = false;
                match result {
                    Ok(()) => this.enter_sign_in(None, cx),
                    Err(_) => {
                        // Still signed in: reconnect the account, then explain.
                        if let Some(auth) = this.auth.clone() {
                            this.enter_workspace(auth, cx);
                        }
                        this.account_error = Some("Sign-out could not finish. Check your connection and try again.".into());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    // ---------- Rendering ----------

    fn render_sign_in(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let confirming = self.confirming();
        let (title, description, submit, switch_text, switch_link) = match self.mode {
            Mode::SignIn => ("Welcome back", "Enter your email and we’ll send you a sign-in link. No password needed.", "Send sign-in link", "New to Remotely?", "Create an account"),
            Mode::SignUp => ("Create your account", "Enter your email to get started. We’ll send a link to confirm it. No password needed.", "Create account", "Already have an account?", "Sign in"),
        };
        let (title, description) = if confirming {
            ("Confirm your sign-in", "Enter the email that received this link. Continue only if you requested it.")
        } else {
            (title, description)
        };
        let label: SharedString = if self.busy {
            if confirming { "Signing in…" } else { "Sending link…" }.into()
        } else if confirming {
            "Continue with email link".into()
        } else if self.sent {
            if self.cooldown > 0 { format!("Resend in {}s", self.cooldown).into() } else { "Resend sign-in link".into() }
        } else {
            submit.into()
        };
        let email_empty = self.email.read(cx).text().trim().is_empty();
        let link_empty = self.link.read(cx).text().trim().is_empty();
        let disabled = self.busy || email_empty || if confirming { link_empty } else { self.mail_ready != Some(true) || self.cooldown > 0 };

        let mut form = div().flex().flex_col().gap_3().child(field("Email address", self.email.clone()));
        if confirming {
            form = form.child(field("Email sign-in link", self.link.clone()));
        } else {
            form = form.child(
                link_button("advanced", if self.show_server { "Hide advanced connection settings" } else { "Advanced connection settings" })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.show_server = !this.show_server;
                        cx.notify();
                    })),
            );
            if self.show_server {
                form = form.child(field("Account server URL", self.server.clone())).child(hint(
                    "Only change this if you host your own service. Both devices must use the same HTTPS server.",
                ));
            }
            match self.mail_ready {
                None => form = form.child(hint("Checking email sign-in…")),
                Some(false) => {
                    form = form.child(
                        notice("Email sign-in is temporarily unavailable", "Please try again shortly or contact support.", false).child(
                            button("check-availability", "Check availability", Style::Outline, false)
                                .on_click(cx.listener(|this, _, _, cx| this.check_config(cx))),
                        ),
                    )
                }
                Some(true) => {}
            }
        }
        if self.sent && !confirming {
            form = form.child(notice("Check your inbox", "If this email is eligible, a sign-in link will arrive shortly. It expires in five minutes. Check your spam folder too.", false));
        }
        if let Some(error) = &self.error {
            form = form.child(notice("Sign-in failed", error.clone(), true));
        }
        form = form.child(
            button("submit", label, Style::Primary, disabled)
                .w_full()
                .when(!disabled, |b| b.on_click(cx.listener(|this, _, window, cx| this.submit(window, cx)))),
        );

        let mut column = div()
            .flex()
            .flex_col()
            .gap_5()
            .w(px(380.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_1()
                    .child(div().text_size(px(24.)).font_weight(FontWeight::SEMIBOLD).child(title))
                    .child(div().text_sm().text_color(theme::muted()).text_center().child(description)),
            )
            .child(form)
            .child(divider(if confirming { "Wrong link?" } else { "Opened the email elsewhere?" }))
            .child(
                button("paste-link", if confirming { "Back to sign in" } else { "Paste a sign-in link" }, Style::Outline, self.busy)
                    .w_full()
                    .when(!self.busy, |b| b.on_click(cx.listener(|this, _, window, cx| this.toggle_paste_link(window, cx)))),
            );
        if !confirming {
            column = column.child(hint("Use the link on this device, or paste it here. Keep the Mac app updated so both devices use email sign-in.").text_center());
        }
        column = column.child(
            div()
                .pt_4()
                .border_t_1()
                .border_color(theme::border())
                .text_xs()
                .text_color(theme::muted())
                .child("Stay signed in for up to 30 days. Sign out on shared devices. Your Mac still approves every screen-sharing session."),
        );
        if !confirming {
            column = column.child(
                div()
                    .flex()
                    .justify_center()
                    .gap_1()
                    .text_sm()
                    .text_color(theme::muted())
                    .child(switch_text)
                    .child(link_button("switch-mode", switch_link).on_click(cx.listener(|this, _, _, cx| {
                        this.mode = if this.mode == Mode::SignIn { Mode::SignUp } else { Mode::SignIn };
                        cx.notify();
                    }))),
            );
        }

        div()
            .size_full()
            .flex()
            .flex_col()
            .child(header(div().text_xs().text_color(theme::muted()).child("MAC APP · GPUI PREVIEW")))
            .child(
                div()
                    .id("sign-in-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(div().min_h_full().flex().items_center().justify_center().p_6().child(column)),
            )
            .into_any_element()
    }

    fn render_workspace(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let auth = self.auth.clone().expect("workspace requires auth");
        let connection = self.connection.clone().expect("workspace has a connection");
        let state = connection.read(cx);
        let actions = div()
            .flex()
            .items_center()
            .gap_3()
            .child(div().text_sm().text_color(theme::muted()).child(auth.user.email.clone()))
            .child(
                button("sign-out", "Sign out", Style::Outline, self.busy)
                    .when(!self.busy, |b| b.on_click(cx.listener(|this, _, _, cx| this.sign_out(cx)))),
            );
        let account_label = if state.ready {
            "Signed in"
        } else if state.status == Status::Connecting {
            "Connecting account…"
        } else {
            "Account disconnected"
        };

        let mut body = div().flex().flex_col().gap_5().w_full().max_w(px(880.)).child(
            div()
                .flex()
                .justify_between()
                .items_center()
                .child(div().text_size(px(28.)).font_weight(FontWeight::SEMIBOLD).child("Get your Mac ready."))
                .child(badge(state.ready, account_label)),
        );
        if let Some(error) = &self.account_error {
            body = body.child(notice("Account needs attention", error.clone(), true));
        }
        if let Some(error) = &state.error {
            let connection = connection.clone();
            body = body.child(notice("Something needs attention", error.clone(), true).child(
                button("dismiss-error", "Dismiss", Style::Outline, false)
                    .on_click(move |_, _, cx| connection.update(cx, |c, cx| c.clear_error(cx))),
            ));
        }
        if !state.ready && state.status == Status::Offline {
            let retry = connection.clone();
            body = body.child(
                notice("Account connection interrupted", "Your desktop session has stopped. Check your network, retry, or sign in again.", false).child(
                    div()
                        .flex()
                        .gap_2()
                        .child(button("retry", "Retry connection", Style::Outline, false).on_click(move |_, _, cx| retry.update(cx, |c, cx| c.retry(cx))))
                        .child(button("offline-sign-out", "Sign out", Style::Outline, self.busy).when(!self.busy, |b| b.on_click(cx.listener(|this, _, _, cx| this.sign_out(cx))))),
                ),
            );
        }
        body = body.child(notice(
            "GPUI preview",
            "This native build shares a display and accepts control from a paired phone after you allow each connection. Remembered approvals are not supported yet, so every connection asks here.",
            false,
        ));
        let (has_pending, has_session) = (state.desktop.pending.is_some(), state.desktop.session.is_some());
        if has_pending {
            body = body.child(self.render_approval(&connection, cx));
        }
        if has_session {
            body = body.child(self.render_session(&connection, cx));
        }

        body = body.child(self.render_setup(&connection, cx));
        body = body.child(self.render_pairing(&connection, cx));

        // ----- Devices -----
        let state = connection.read(cx);
        let devices = state.devices.clone();
        let macs = devices.iter().filter(|d| d.kind == "desktop").count();
        let phones = devices.len() - macs;
        let mut list = div().flex().flex_col().gap_2();
        if devices.is_empty() {
            list = list.child(hint(if state.status == Status::Connecting { "Connecting to your account to find your devices…" } else { "No devices yet." }));
        }
        for device in &devices {
            list = list.child(device_row(device, device.id == state.device_id));
        }
        let refresh = connection.clone();
        let devices_card = card()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_start()
                    .child(div().flex().flex_col().gap_1().child(eyebrow("Account")).child(div().text_size(px(18.)).font_weight(FontWeight::MEDIUM).child("My devices")))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(div().text_sm().text_color(theme::muted()).child(format!(
                                "{macs} {} · {phones} {}",
                                if macs == 1 { "Mac" } else { "Macs" },
                                if phones == 1 { "phone" } else { "phones" }
                            )))
                            .child(button("refresh", "Refresh", Style::Outline, false).on_click(move |_, _, cx| refresh.update(cx, |c, cx| c.refresh_devices(cx)))),
                    ),
            )
            .child(hint("Devices registered to this account. Online means the device’s app is open and connected right now."))
            .child(list);
        body = body.child(devices_card).child(div().text_sm().text_color(theme::muted()).child(format!("Account server: {}", auth.service)));

        div()
            .size_full()
            .flex()
            .flex_col()
            .child(header(actions))
            .child(
                div()
                    .id("workspace-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .items_center()
                    .p_8()
                    .child(body),
            )
            .into_any_element()
    }

    /// A phone's connection request (ApprovalCard.tsx).
    fn render_approval(&mut self, connection: &Entity<Connection>, cx: &mut Context<Self>) -> Div {
        let state = connection.read(cx);
        let Some(pending) = state.desktop.pending.clone() else { return div() };
        let ready = state.setup_ready();
        let approving = state.desktop.approving;
        if pending.unlocked {
            return card().border_color(theme::accent()).child(div().text_size(px(18.)).font_weight(FontWeight::MEDIUM).child(format!("{} is reconnecting", pending.name))).child(hint(
                "It proved a fresh unlock with its passkey, so this Mac is allowing it without asking.",
            ));
        }
        let (allow, decline) = (connection.clone(), connection.clone());
        let choice = pending.can_remember.then(|| self.render_remember_choice(&pending.id, "card", cx));
        let mut panel = card()
            .border_color(theme::accent())
            .child(div().text_size(px(18.)).font_weight(FontWeight::MEDIUM).child(format!("{} wants to connect", pending.name)))
            .child(div().text_sm().text_color(theme::muted()).child(
                "Paired with this Mac using its device key. Allowing this request shares your selected display and enables mouse and keyboard control.",
            ));
        if !ready {
            panel = panel.child(hint("Complete the Mac setup checklist below before allowing this request."));
        }
        let can_allow = ready && !approving;
        panel.when_some(choice, |panel, choice| panel.child(choice)).child(
            div()
                .flex()
                .gap_2()
                .child(
                    button("allow-connection", if approving { "Allowing…" } else { "Allow connection" }, Style::Primary, !can_allow).when(can_allow, |b| {
                        b.on_click(cx.listener(move |this, _, _, cx| {
                            let ms = this.remember_ms;
                            allow.update(cx, |c, cx| c.approve(ms, cx));
                        }))
                    }),
                )
                .child(
                    button("decline-connection", "Decline", Style::Outline, approving)
                        .when(!approving, |b| b.on_click(move |_, _, cx| decline.update(cx, |c, cx| c.decline(cx)))),
                ),
        )
    }

    /// "Skip approval for": how long this phone may reconnect without asking (≤ 3 days).
    fn render_remember_choice(&mut self, request_id: &str, place: &'static str, cx: &mut Context<Self>) -> Div {
        if self.remember_request != request_id {
            self.remember_request = request_id.to_string();
            self.remember_ms = 0;
        }
        let mut row = div().flex().flex_wrap().items_center().gap_2().child(div().text_sm().text_color(theme::muted()).child("Skip approval for"));
        for (label, ms) in crate::remember::OPTIONS {
            let selected = self.remember_ms == ms;
            row = row.child(
                button(SharedString::from(format!("remember-{place}-{ms}")), label, if selected { Style::Primary } else { Style::Outline }, false).h(px(30.)).px_3().on_click(cx.listener(move |this, _, _, cx| {
                    this.remember_ms = ms;
                    cx.notify();
                })),
            );
        }
        row
    }

    /// The active session with End session.
    fn render_session(&mut self, connection: &Entity<Connection>, cx: &mut Context<Self>) -> Div {
        let state = connection.read(cx);
        let Some(session) = state.desktop.session.clone() else { return div() };
        let status = if state.desktop.session_status == Some(SessionStatus::Connected) { "Connected" } else { "Connecting…" };
        let end = connection.clone();
        card().child(
            div()
                .flex()
                .justify_between()
                .items_center()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().font_weight(FontWeight::MEDIUM).child(format!("{} · {status}", session.name)))
                        .child(hint("Your selected display is being shared and this phone can control the mouse and keyboard.")),
                )
                .child(button("end-session", "End session", Style::Primary, false).on_click(move |_, _, cx| end.update(cx, |c, cx| c.end(cx)))),
        )
    }

    /// "Share your workspace" checklist (DesktopSetup.tsx).
    fn render_setup(&mut self, connection: &Entity<Connection>, _cx: &mut Context<Self>) -> Div {
        let state = connection.read(_cx);
        let d = &state.desktop;
        let busy = d.session.is_some() || d.approving;
        let ready = state.setup_ready();
        let control_ready = d.accessibility && d.driver_ready;
        let badge_text = if busy { "Session active" } else if ready { "Ready for a request" } else { "Setup needed" };
        let step = |n: u32, title: &'static str, done: bool, text: String| {
            div()
                .flex()
                .gap_3()
                .items_start()
                .child(
                    div()
                        .size(px(22.))
                        .flex_none()
                        .rounded_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_xs()
                        .border_1()
                        .border_color(if done { theme::success() } else { theme::border() })
                        .text_color(if done { theme::success() } else { theme::muted() })
                        .child(if done { "✓".to_string() } else { n.to_string() }),
                )
                .child(div().flex().flex_col().gap_0p5().child(div().text_sm().font_weight(FontWeight::MEDIUM).child(title)).child(hint(text)))
        };
        let mut displays = div().flex().flex_wrap().gap_2().pl(px(34.));
        for display in d.displays.clone() {
            let selected = d.selected == Some(display.id);
            let pick = connection.clone();
            let id = display.id;
            displays = displays.child(
                button(
                    SharedString::from(format!("display-{id}")),
                    format!("{}{} · {}×{}", if selected { "✓ " } else { "" }, display.label, display.width, display.height),
                    if selected { Style::Primary } else { Style::Outline },
                    busy,
                )
                .when(!busy, |b| b.on_click(move |_, _, cx| pick.update(cx, |c, cx| c.select_display(id, cx)))),
            );
        }
        let (load, check) = (connection.clone(), connection.clone());
        let mut panel = card()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_start()
                    .child(div().flex().flex_col().gap_1().child(eyebrow("Mac setup")).child(div().text_size(px(18.)).font_weight(FontWeight::MEDIUM).child("Share your workspace")))
                    .child(badge(ready || busy, badge_text)),
            )
            .child(div().text_sm().text_color(theme::muted()).child(
                "Share a full display to switch between your editor, browser, and other apps. Your screen stays private until you approve a request.",
            ))
            .child(step(1, "Connect your account", state.ready, if state.ready { "Signed in. Use the same account on your phone.".into() } else { "Waiting for the account connection.".into() }))
            .child(step(2, "Allow Screen Recording", d.screen, if d.screen { "Mac Remote can share your selected display.".into() } else { "Choose a display below. If macOS asks, enable Mac Remote in Privacy & Security → Screen & System Audio Recording.".into() }))
            .child(step(
                3,
                "Allow Accessibility",
                control_ready,
                if !d.accessibility { "Enable Mac Remote in System Settings → Privacy & Security → Accessibility.".into() } else if !d.driver_ready { "Permission is enabled, but the input driver is unavailable. Run npm run build:driver and reopen Mac Remote.".into() } else { "The input driver and control permission are ready.".into() },
            ))
            .child(step(4, "Choose a display", d.selected.is_some(), if d.selected.is_some() { "This is the display your phone will see. End a session before changing it.".into() } else { "Select the display containing the editor or apps you want to use.".into() }))
            .child(displays);
        if let Some(error) = &d.setup_error {
            panel = panel.child(notice("Mac setup needs attention", error.clone(), true));
        }
        panel
            .child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        button("load-displays", if d.loading_displays { "Loading displays…" } else if d.displays.is_empty() { "Choose display" } else { "Refresh displays" }, Style::Outline, busy || d.loading_displays)
                            .when(!busy && !d.loading_displays, |b| b.on_click(move |_, _, cx| load.update(cx, |c, cx| c.load_displays(cx)))),
                    )
                    .child(button("check-permissions", "Check permissions", Style::Outline, busy).when(!busy, |b| b.on_click(move |_, _, cx| check.update(cx, |c, cx| c.check_permissions(true, cx))))),
            )
            .child(hint(if busy { "A session is active. Use End session to stop sharing and control." } else if ready { "Ready. Select this Mac on your phone, then approve the request here." } else { "Finish the checklist before approving a connection." }))
    }

    /// "Pair your phone" (DevicePairing.tsx, Mac side).
    fn render_pairing(&mut self, connection: &Entity<Connection>, cx: &mut Context<Self>) -> Div {
        let state = connection.read(cx);
        let can_create = state.ready && !state.busy;
        let create = connection.clone();
        let mut section = card()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(eyebrow("Trusted devices"))
                    .child(div().text_size(px(18.)).font_weight(FontWeight::MEDIUM).child("Pair your phone")),
            )
            .child(div().text_sm().text_color(theme::muted()).child(
                "Create a one-use link, scan it with your phone’s Camera, then approve pairing here. Only share it with your own phone.",
            ))
            .child(
                div().flex().child(
                    button("create-invite", if state.invite.is_some() { "Create a new pairing link" } else { "Create pairing link" }, Style::Outline, !can_create)
                        .when(can_create, |b| {
                            b.on_click(cx.listener(move |this, _, _, cx| {
                                this.copy_status.clear();
                                create.update(cx, |c, cx| c.create_invite(cx));
                            }))
                        }),
                ),
            );

        if let Some(invite) = state.invite.clone() {
            let remaining = ((invite.expires - store::now_ms()).max(0) / 1000) as u64;
            let link = invite.link.clone();
            let mut block = div().flex().flex_col().gap_3();
            match qr::qr(&invite.link, px(300.)) {
                Some(code) => block = block.child(div().rounded_lg().overflow_hidden().w(px(300.)).child(code)),
                None => block = block.child(hint("QR unavailable. Copy the pairing link instead.")),
            }
            block = block
                .child(div().text_sm().font_weight(FontWeight::MEDIUM).child("One-use pairing link"))
                .child(
                    div()
                        .p_2()
                        .rounded_md()
                        .border_1()
                        .border_color(theme::border())
                        .text_xs()
                        .text_color(theme::muted())
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .child(invite.link.clone()),
                )
                .child(div().flex().child(button("copy-link", "Copy pairing link", Style::Outline, false).on_click(cx.listener(move |this, _, _, cx| {
                    cx.write_to_clipboard(ClipboardItem::new_string(link.clone()));
                    this.copy_status = "Pairing link copied.".into();
                    cx.notify();
                }))))
                .child(hint(format!("Expires in {}:{:02}. Your screen stays private during pairing.", remaining / 60, remaining % 60)));
            section = section.child(block);
        }

        if let Some(pending) = state.pairing.clone() {
            let (allow, decline) = (connection.clone(), connection.clone());
            let busy = state.busy;
            section = section.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .pt_4()
                    .border_t_1()
                    .border_color(theme::border())
                    .child(div().font_weight(FontWeight::MEDIUM).child(format!("Pair {}?", pending.name)))
                    .child(div().text_sm().text_color(theme::muted()).child(
                        "This device proved it has your one-use link. Approve only if you just scanned or pasted it on your phone. Pairing does not start screen sharing.",
                    ))
                    .child(div().text_xs().text_color(theme::muted()).child(format!("Device key: {}", &pending.peer_id[2..])))
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(button("allow-pair", "Allow pairing", Style::Primary, busy).when(!busy, |b| b.on_click(move |_, _, cx| allow.update(cx, |c, cx| c.approve_pair(cx)))))
                            .child(button("decline-pair", "Decline pairing", Style::Outline, busy).when(!busy, |b| b.on_click(move |_, _, cx| decline.update(cx, |c, cx| c.decline_pair(cx))))),
                    ),
            );
        }

        let status = if self.copy_status.is_empty() { state.pair_status.clone() } else { self.copy_status.clone() };
        if !status.is_empty() {
            section = section.child(div().text_sm().text_color(theme::muted()).child(status));
        }

        if !state.pins.is_empty() {
            let mut list = div().flex().flex_col().gap_3();
            for (id, pin) in state.pins.clone() {
                let confirming = self.revoke_id.as_deref() == Some(id.as_str());
                let mut row = div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .min_w_0()
                                    .child(div().text_sm().child(pin.name.clone()))
                                    .when_some(remembered_text(state.desktop.remembered.get(&id).filter(|r| r.grant_id == pin.grant_id)), |col, text| {
                                        col.child(div().text_xs().text_color(theme::success()).child(text))
                                    })
                                    .child(div().text_xs().text_color(theme::muted()).child(format!("Device key {}", &id[2..]))),
                            )
                            .when(!confirming, |row| {
                                let id = id.clone();
                                let remembered = state.desktop.remembered.get(&id).is_some_and(|r| r.grant_id == pin.grant_id);
                                let forget = connection.clone();
                                let forget_id = id.clone();
                                row.child(
                                    div()
                                        .flex()
                                        .gap_2()
                                        .when(remembered, |actions| {
                                            actions.child(button(SharedString::from(format!("forget-{id}")), "Forget", Style::Outline, false).on_click(move |_, _, cx| {
                                                forget.update(cx, |c, cx| {
                                                    c.forget_remembered(Some(&forget_id));
                                                    cx.notify();
                                                })
                                            }))
                                        })
                                        .child(button(SharedString::from(format!("revoke-{id}")), "Revoke", Style::Outline, false).on_click(cx.listener(move |this, _, _, cx| {
                                            this.revoke_id = Some(id.clone());
                                            cx.notify();
                                        }))),
                                )
                            }),
                    );
                if confirming {
                    let revoke = connection.clone();
                    let peer = id.clone();
                    row = row.child(
                        notice("Revoke this device?", "Its active session will end. A new pairing link and approval on the Mac will be required to reconnect.", true).child(
                            div()
                                .flex()
                                .gap_2()
                                .child(button("confirm-revoke", "Revoke device", Style::Primary, false).on_click(cx.listener(move |this, _, _, cx| {
                                    this.revoke_id = None;
                                    let peer = peer.clone();
                                    revoke.update(cx, |c, cx| c.revoke(peer, cx));
                                })))
                                .child(button("cancel-revoke", "Cancel", Style::Outline, false).on_click(cx.listener(|this, _, _, cx| {
                                    this.revoke_id = None;
                                    cx.notify();
                                }))),
                        ),
                    );
                }
                list = list.child(row);
            }
            section = section.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .pt_4()
                    .border_t_1()
                    .border_color(theme::border())
                    .child(div().font_weight(FontWeight::MEDIUM).child("Paired phones"))
                    .child(list),
            );
        }
        section
    }
}

impl Render for MacRemote {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = match self.screen {
            Screen::Restoring => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme::muted())
                .child("Restoring your sign-in…")
                .into_any_element(),
            Screen::SignIn => self.render_sign_in(cx),
            Screen::Workspace => self.render_workspace(cx),
        };
        let toast = matches!(self.screen, Screen::Workspace).then(|| self.render_toast(cx)).flatten();
        let update = self.render_update(cx);
        div()
            .relative()
            .size_full()
            .bg(theme::background())
            .text_color(theme::text())
            .text_size(px(14.))
            .font_family(".SystemUIFont")
            .child(content)
            .when_some(toast, |root, toast| root.child(toast))
            .when_some(update, |root, update| root.child(update))
    }
}

impl MacRemote {
    /// Checks the account service for a newer release at launch and every 6 hours.
    fn watch_updates(&mut self, cx: &mut Context<Self>) {
        self.update_task = Some(cx.spawn(async move |this, cx| loop {
            let service = this
                .read_with(cx, |this, cx| this.auth.as_ref().map(|a| a.service.clone()).or_else(|| account::service_url(&this.server.read(cx).text()).ok()))
                .ok()
                .flatten();
            if let Some(service) = service {
                let result = cx.background_executor().spawn(async move { crate::update::check(&service) }).await;
                // Offline or unavailable: keep what we had and try again later.
                if let Ok(update) = result {
                    if this.update(cx, |this, cx| {
                        if update.as_ref().is_some_and(|u| this.update.as_ref() != Some(u)) {
                            crate::log::log(format!("update available: {}", update.as_ref().map(|u| u.latest.as_str()).unwrap_or_default()));
                        }
                        this.update = update;
                        cx.notify();
                    })
                    .is_err()
                    {
                        break;
                    }
                }
            }
            cx.background_executor().timer(crate::update::CHECK_EVERY).await;
        }));
    }

    /// "Update available" card, or a blocking dialog when this version is no longer supported.
    fn render_update(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let update = self.update.clone()?;
        if !update.required && self.update_dismissed == update.latest {
            return None;
        }
        let page = crate::update::download_page(&update.service)?;
        let actions = div()
            .flex()
            .gap_2()
            .child(button("update-download", "Download update", Style::Primary, false).on_click(move |_, _, cx| cx.open_url(&page)))
            .when(!update.required, |row| {
                let latest = update.latest.clone();
                row.child(button("update-later", "Later", Style::Outline, false).on_click(cx.listener(move |this, _, _, cx| {
                    store::dismiss_update(&latest);
                    this.update_dismissed = latest.clone();
                    cx.notify();
                })))
            });
        let panel = div().flex().flex_col().gap_3().p_5().rounded_lg().border_1().bg(theme::card()).shadow_lg();
        Some(if update.required {
            div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .bg(gpui::rgba(0x000000b3))
                .occlude()
                .child(
                    panel
                        .w(px(440.))
                        .border_color(theme::danger())
                        .child(div().text_size(px(18.)).font_weight(FontWeight::SEMIBOLD).child("Update required"))
                        .child(div().text_sm().text_color(theme::muted()).child(format!(
                            "This version of Mac Remote ({}) is no longer supported. Download version {}, then replace the app in Applications and reopen it.",
                            crate::update::CURRENT, update.latest
                        )))
                        .child(actions),
                )
                .into_any_element()
        } else {
            div()
                .absolute()
                .bottom(px(24.))
                .right(px(24.))
                .w(px(340.))
                .child(
                    panel
                        .border_color(theme::accent())
                        .child(eyebrow("Update available"))
                        .child(div().text_size(px(16.)).font_weight(FontWeight::MEDIUM).child(format!("Mac Remote {} is ready", update.latest)))
                        .child(hint("Download it, replace the app in Applications, and reopen it. Your sign-in and paired phones are kept."))
                        .child(actions),
                )
                .into_any_element()
        })
    }

    /// Pairing and connection requests float over the window, wherever it is scrolled.
    fn render_toast(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let connection = self.connection.clone()?;
        let state = connection.read(cx);
        let mut choice = None;
        let (title, body, allow_label, busy, kind) = if let Some(pending) = state.desktop.pending.clone() {
            if pending.unlocked {
                return None;
            }
            if pending.can_remember {
                choice = Some(pending.id.clone());
            }
            let ready = state.setup_ready();
            (
                format!("{} wants to connect", pending.name),
                if ready { "Allowing shares your selected display and enables mouse and keyboard control.".to_string() } else { "Finish the Mac setup checklist before allowing this request.".to_string() },
                if state.desktop.approving { "Allowing…" } else { "Allow connection" },
                state.desktop.approving || !ready,
                "connection",
            )
        } else if let Some(pairing) = state.pairing.clone() {
            (
                format!("Pair {}?", pairing.name),
                "This device used your one-use pairing link. Allow only if you just scanned it on your phone. Pairing does not share your screen.".to_string(),
                "Allow pairing",
                state.busy,
                "pairing",
            )
        } else {
            return None;
        };
        let (allow, decline) = (connection.clone(), connection.clone());
        let pairing = kind == "pairing";
        let choice = choice.map(|id| self.render_remember_choice(&id, "toast", cx));
        Some(
            div()
                .absolute()
                .top(px(72.))
                .right(px(24.))
                .w(px(380.))
                .flex()
                .flex_col()
                .gap_3()
                .p_4()
                .rounded_lg()
                .border_1()
                .border_color(theme::accent())
                .bg(theme::notice())
                .shadow_lg()
                .child(eyebrow(if pairing { "Pairing request" } else { "Connection request" }))
                .child(div().text_size(px(16.)).font_weight(FontWeight::MEDIUM).child(title))
                .child(div().text_sm().text_color(theme::muted()).child(body))
                .when_some(choice, |toast, choice| toast.child(choice))
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(button("toast-allow", allow_label, Style::Primary, busy).when(!busy, |b| {
                            b.on_click(cx.listener(move |this, _, _, cx| {
                                let ms = this.remember_ms;
                                allow.update(cx, |c, cx| if pairing { c.approve_pair(cx) } else { c.approve(ms, cx) })
                            }))
                        }))
                        .child(button("toast-decline", "Decline", Style::Outline, false).on_click(move |_, _, cx| {
                            decline.update(cx, |c, cx| if pairing { c.decline_pair(cx) } else { c.decline(cx) })
                        })),
                )
                .into_any_element(),
        )
    }
}

// ---------- Small building blocks ----------

#[derive(Clone, Copy)]
enum Style {
    Primary,
    Outline,
}

fn button(id: impl Into<gpui::ElementId>, label: impl Into<SharedString>, style: Style, disabled: bool) -> Stateful<Div> {
    let base = div()
        .id(id)
        .h(px(40.))
        .px_4()
        .flex()
        .items_center()
        .justify_center()
        .rounded_md()
        .text_sm()
        .font_weight(FontWeight::MEDIUM)
        .child(label.into());
    let base = match style {
        Style::Primary => base.bg(theme::accent()).text_color(theme::accent_text()),
        Style::Outline => base.border_1().border_color(theme::border()).bg(theme::card()).text_color(theme::text()),
    };
    if disabled {
        base.opacity(0.45)
    } else {
        base.cursor_pointer().hover(|s| s.opacity(0.85))
    }
}

fn link_button(id: &'static str, label: &'static str) -> Stateful<Div> {
    div()
        .id(id)
        .text_sm()
        .text_color(theme::text())
        .underline()
        .cursor_pointer()
        .hover(|s| s.text_color(theme::accent()))
        .child(label)
}

fn field(label: &'static str, input: Entity<TextInput>) -> Div {
    div().flex().flex_col().gap_1p5().child(div().text_sm().font_weight(FontWeight::MEDIUM).child(label)).child(input)
}

fn hint(text: impl Into<SharedString>) -> Div {
    div().text_xs().text_color(theme::muted()).child(text.into())
}

fn eyebrow(text: &'static str) -> Div {
    div().text_xs().text_color(theme::accent()).child(text.to_uppercase())
}

fn notice(title: impl Into<SharedString>, body: impl Into<SharedString>, error: bool) -> Div {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .p_3()
        .rounded_md()
        .border_1()
        .border_color(if error { theme::danger() } else { theme::border() })
        .bg(theme::notice())
        .child(div().text_sm().font_weight(FontWeight::MEDIUM).text_color(if error { theme::danger() } else { theme::text() }).child(title.into()))
        .child(div().text_sm().text_color(theme::muted()).child(body.into()))
}

fn divider(text: &'static str) -> Div {
    div()
        .flex()
        .items_center()
        .gap_3()
        .text_xs()
        .text_color(theme::muted())
        .child(div().h(px(1.)).flex_1().bg(theme::border()))
        .child(text)
        .child(div().h(px(1.)).flex_1().bg(theme::border()))
}

fn card() -> Div {
    div().flex().flex_col().gap_4().p_6().rounded_lg().border_1().border_color(theme::border()).bg(theme::card())
}

fn badge(online: bool, label: &'static str) -> Div {
    div()
        .flex()
        .items_center()
        .gap_2()
        .px_3()
        .py_1()
        .rounded_full()
        .border_1()
        .border_color(theme::border())
        .text_xs()
        .child(dot(online))
        .child(label)
}

fn dot(online: bool) -> Div {
    div().size(px(8.)).rounded_full().bg(if online { theme::success() } else { theme::muted() })
}

fn header(actions: Div) -> Div {
    div()
        .flex()
        .justify_between()
        .items_center()
        .px_6()
        .py_4()
        .border_b_1()
        .border_color(theme::border())
        .child(div().text_size(px(16.)).font_weight(FontWeight::SEMIBOLD).child("Remotely"))
        .child(actions)
}

/// "Skips approval for 2 more days", from a remembered record.
fn remembered_text(record: Option<&crate::remember::RememberedPhone>) -> Option<String> {
    let left = record?.until - store::now_ms();
    if left <= 0 {
        return None;
    }
    let hours = (left + 3_599_999) / 3_600_000;
    Some(if hours > 24 { format!("Skips approval for {} more days", (hours + 23) / 24) } else if hours == 1 { "Skips approval for 1 more hour".into() } else { format!("Skips approval for {hours} more hours") })
}

fn device_row(device: &Device, this_mac: bool) -> Div {
    let kind = if this_mac { "This Mac" } else if device.kind == "desktop" { "Mac" } else { "Phone" };
    let status = if device.public_key.is_none() {
        "Update the app to enable trusted pairing"
    } else if device.online {
        "Online"
    } else {
        "Offline"
    };
    let key = device.id.strip_prefix("d_").unwrap_or(&device.id);
    let short_key: String = key.chars().take(12).collect();
    div()
        .flex()
        .items_center()
        .gap_4()
        .p_3()
        .rounded_md()
        .border_1()
        .border_color(theme::border())
        .child(
            div()
                .w(px(56.))
                .text_xs()
                .text_color(theme::muted())
                .child(kind),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap_0p5()
                .child(div().font_weight(FontWeight::MEDIUM).child(device.name.clone()))
                .child(div().flex().items_center().gap_2().text_xs().text_color(theme::muted()).child(dot(device.online)).child(status)),
        )
        .child(div().text_xs().text_color(theme::muted()).child(format!("Key {short_key}…")))
}

