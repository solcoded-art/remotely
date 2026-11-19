import type { PublicKey, Grant } from '../../shared/trust.mjs';
import type { Pin } from './identity';
export type User = { id: string; email: string };
export type Auth = { user: User; token: string; expires: number; service: string };
export type Device = { id: string; name: string; kind: 'desktop' | 'controller'; online: boolean; publicKey: PublicKey | null };
export type RunningApp = { pid: number; name: string; bundleId: string; active: boolean };
export type DisplaySource = { id: string; displayId: string; name: string; thumbnail: string };
export type Permissions = { accessibility: boolean; screen: string };
export type DriverEvent = { action: string; requestId?: string; apps?: RunningApp[]; error?: string; message?: string; ok?: boolean };
export type Command = Record<string, unknown> & { action: string };
export type Signal = { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidate: RTCIceCandidateInit };
export type ServerMessage = {
  type: string; controllerNonce?: string; desktopNonce?: string; requestSignature?: string; approvalSignature?: string; challenge?: string; peerId?: string; grantId?: string; inviteId?: string; requestId?: string; expires?: number; proof?: string; publicKey?: PublicKey; grant?: Grant; signature?: string; seq?: number; devices?: Device[]; sessionId?: string; name?: string; reason?: string; message?: string; signal?: Signal;
};
declare global {
  interface Window {
    macRemote?: {
      platform: 'mac';
      authSession?(service: string, value?: { token: string; expires: number } | null): Promise<{ token: string; expires: number } | null>;
      identity(scope: string): Promise<PublicKey>;
      sign(scope: string, message: string): Promise<string>;
      pins(scope: string): Promise<Record<string, Pin>>;
      pin(scope: string, id: string, value: Pin | null): Promise<void>;
      info(): Promise<{ name: string; driverReady: boolean }>;
      sources(): Promise<DisplaySource[]>;
      selectDisplay(id: string): Promise<void>;
      approve(sessionId: string): Promise<void>;
      end(): Promise<void>;
      command(sessionId: string, command: Command): Promise<void>;
      permissions(prompt: boolean): Promise<Permissions>;
      onDriver(listener: (event: DriverEvent) => void): () => void;
    };
  }
}
