const { createHash, timingSafeEqual } = require('node:crypto');
const { passwordHash } = require('./store.cjs');
const { isDisposableEmail } = require('disposable-email-domains-js');
const error = (status, message) => Object.assign(Error(message), { status });

function emailPolicy(email) {
  const domain = email.split('@')[1];
  const list = key => (process.env[key] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const match = item => domain === item || domain?.endsWith('.' + item);
  if (list('EMAIL_DOMAIN_ALLOWLIST').some(match)) return null;
  if (list('EMAIL_BLOCKED_DOMAINS').some(match)) return 'blocked_domain';
  return isDisposableEmail(email) ? 'disposable_domain' : null;
}
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const [local, domain, extra] = email.split('@');
  const labels = domain?.split('.') || [];
  if (email.length > 254 || extra !== undefined || !local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw error(400, 'Enter a valid email address.');
  return email;
}
async function createAuthentication({ store, publicOrigin, origins, allowRegistration, secret, sendMail, enableMagicLinks }) {
  const configuredSecret = secret ?? process.env.BETTER_AUTH_SECRET;
  if (configuredSecret && configuredSecret.length < 32) throw Object.assign(Error('Invalid authentication secret.'), { code: 'AUTH_SECRET_INVALID' });
  let auth = null;
  let deliver = sendMail;
  const smtp = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_DOMAIN'].every(key => !!process.env[key]);
  if (!deliver && smtp) {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: false, requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000 });
    const from = process.env.SMTP_FROM_ADDRESS || `no-reply@${process.env.SMTP_FROM_DOMAIN}`;
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[^\s@]+$/.test(from) || from.split('@')[1].toLowerCase() !== process.env.SMTP_FROM_DOMAIN.toLowerCase()) throw Object.assign(Error('Invalid sender address.'), { code: 'SMTP_FROM_INVALID' });
    deliver = async ({ email, url }) => transport.sendMail({ from: `Remotely <${from}>`, to: email,
      subject: 'Your Remotely sign-in link', text: `Use this link to sign in to Remotely:\n\n${url}\n\nThis single-use link expires in 5 minutes. Open it on the device you want to sign in to, or paste it into that app. If you did not request it, ignore this email.` });
  }
  const magicAvailable = !!((enableMagicLinks ?? process.env.MAGIC_LINK_ENABLED === 'true') && configuredSecret && publicOrigin && deliver);
  if (configuredSecret && publicOrigin) {
    const { betterAuth } = await import('better-auth');
    const { magicLink } = await import('better-auth/plugins');
    const { hashPassword, verifyPassword } = await import('better-auth/crypto');
    auth = betterAuth({ appName: 'Remotely', secret: configuredSecret, baseURL: publicOrigin, basePath: '/api/identity', database: store.pool,
      trustedOrigins: [...origins], logger: { disabled: true },
      advanced: { database: { generateId: () => require('node:crypto').randomUUID() } },
      session: { modelName: 'remote_auth_sessions', expiresIn: 30 * 86400, fields: { userId: 'user_id', expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at', ipAddress: 'ip_address', userAgent: 'user_agent' } },
      user: { modelName: 'remote_users', fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' } },
      account: { modelName: 'remote_auth_accounts', fields: { accountId: 'account_id', providerId: 'provider_id', userId: 'user_id', accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token', accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
      verification: { modelName: 'remote_auth_verifications', fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
      emailAndPassword: { enabled: true, disableSignUp: !allowRegistration, minPasswordLength: 12, maxPasswordLength: 256,
        password: { hash: hashPassword, verify: async ({ hash, password }) => {
          if (!hash.startsWith('legacy$')) return verifyPassword({ hash, password });
          const [, salt, saved] = hash.split('$'); const actual = await passwordHash(password, salt);
          return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(saved, 'hex'));
        } } },
      plugins: [magicLink({ expiresIn: 300, storeToken: { type: 'custom-hasher', hash: async token => createHash('sha256').update(token).digest('hex') }, disableSignUp: !allowRegistration,
        sendMagicLink: async ({ email, token }) => {
          if (!magicAvailable) throw error(503, 'Email sign-in is not configured yet. Use your password.');
          await deliver({ email, url: publicOrigin + '/#sign-in=' + encodeURIComponent(token) });
        } })],
    });
  }
  function cookieName(secure) { return secure ? '__Host-remotely-session' : 'remotely-session'; }
  function secureRequest(req) { return publicOrigin?.startsWith('https:') || req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'; }
  function cookie(req, res, token, expires) {
    const secure = !!secureRequest(req);
    res.setHeader('Set-Cookie', `${cookieName(secure)}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? Math.max(0, Math.floor((expires - Date.now()) / 1000)) : 0}${secure ? '; Secure' : ''}`);
  }
  function tokenFrom(req) {
    const header = req.headers.authorization;
    if (header) return header.replace(/^Bearer /, '');
    const name = cookieName(!!secureRequest(req));
    return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
  }
  async function checkEmail(email) {
    const reason = emailPolicy(email);
    if (!reason) return;
    // Domain classification is a risk signal, not a verdict about a person.
    await store.pool.query(`INSERT INTO remote_auth_email_flags (email_hash, reason) VALUES ($1, $2)
      ON CONFLICT (email_hash) DO UPDATE SET reason = EXCLUDED.reason, attempts = remote_auth_email_flags.attempts + 1, last_seen = NOW()`, [createHash('sha256').update(email).digest('hex'), reason]);
    throw error(400, 'This email provider is not supported. Use a permanent email address, or contact the service owner if this looks incorrect.');
  }
  async function result(value, req, res) {
    const saved = await store.session(value.token);
    if (!saved) throw error(401, 'Sign in to continue.');
    cookie(req, res, saved.token, saved.expires);
    return { ...saved, hasPassword: await store.hasPassword(saved.user.id) };
  }
  return {
    magicAvailable, tokenFrom, cookie, checkEmail,
    async password(email, password, register, remember, req, res) {
      if (register) await checkEmail(email);
      if (!auth) {
        const user = register ? await store.register(email, password) : await store.login(email, password);
        if (!user) throw error(401, 'Email or password is incorrect.');
        return result(await store.issue(user.id, remember), req, res);
      }
      if (!register) await store.importLegacyAccount(email);
      try {
        const value = await auth.api[register ? 'signUpEmail' : 'signInEmail']({ body: { email, password, name: '', rememberMe: remember } });
        return await result(value, req, res);
      } catch (failure) {
        if (failure.status === 409 || failure.body?.code?.includes('ALREADY')) throw error(409, 'Unable to create this account. Try signing in.');
        if (failure.statusCode === 401 || failure.body?.code === 'INVALID_EMAIL_OR_PASSWORD') throw error(401, 'Email or password is incorrect.');
        throw error(500, 'The authentication service could not complete this request.');
      }
    },
    async restore(req, res) {
      const token = tokenFrom(req); const saved = await store.session(token);
      if (!saved) { cookie(req, res, null, 0); throw error(401, 'Sign in to continue.'); }
      return result(saved, req, res);
    },
    async send(email) {
      if (!magicAvailable) throw error(503, 'Email sign-in is not configured yet. Use your password.');
      await checkEmail(email);
      try { await auth.api.signInMagicLink({ body: { email }, headers: new Headers({ origin: publicOrigin }) }); }
      catch { throw error(503, 'Unable to send a sign-in link right now. Try again later or use your password.'); }
      return { status: 'ok', message: 'If this email is eligible, a sign-in link will arrive shortly.' };
    },
    async verify(token, email, req, res) {
      if (!magicAvailable || typeof token !== 'string' || !/^[a-zA-Z0-9_-]{16,256}$/.test(token)) throw error(400, 'This sign-in link is invalid or expired. Request a new one.');
      // Require the recipient email as well as explicit POST confirmation to prevent login CSRF.
      // The purpose prefix is part of the pinned Better Auth magic-link storage contract.
      const identifier = 'magic-link:' + createHash('sha256').update(token).digest('hex');
      const pending = (await store.pool.query('SELECT value FROM remote_auth_verifications WHERE identifier = $1 AND expires_at > NOW()', [identifier])).rows[0];
      if (!pending || JSON.parse(pending.value).email !== email) throw error(400, 'This sign-in link is invalid or expired. Request a new one.');
      try {
        // No redirect or arbitrary callback URL is accepted. GET never consumes emailed links.
        const value = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers({ origin: publicOrigin }) });
        // Mirror Better Auth's unproven-session cleanup for pre-migration login sessions.
        // Device identities and pairing records are preserved.
        if (!await store.hasPassword(value.user.id)) {
          await store.pool.query('UPDATE remote_users SET salt = NULL, hash = NULL WHERE id = $1', [value.user.id]);
          await store.pool.query('DELETE FROM remote_sessions WHERE user_id = $1', [value.user.id]);
        }
        return await result(value, req, res);
      } catch { throw error(400, 'This sign-in link is invalid or expired. Request a new one.'); }
    },
  };
}
module.exports = { createAuthentication, normalizeEmail, emailPolicy };
