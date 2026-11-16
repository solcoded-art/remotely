export type User = { id: string; email: string };
export type Auth = { user: User; token: string; expires: number; service: string };
export type Device = { id: string; name: string; kind: 'desktop' | 'controller'; online: boolean };
export type RunningApp = { pid: number; name: string; bundleId: string; active: boolean };
export type DisplaySource = { id: string; displayId: string; name: string; thumbnail: string };
export type Permissions = { accessibility: boolean; screen: string };
export type DriverEvent = { action: string; requestId?: string; apps?: RunningApp[]; error?: string; message?: string; ok?: boolean };
export type Command = Record<string, unknown> & { action: string };
export type Signal = { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidate: RTCIceCandidateInit };
export type ServerMessage = {
  type: string; devices?: Device[]; sessionId?: string; name?: string; reason?: string; message?: string; signal?: Signal;
};
declare global {
  interface Window {
    macRemote?: {
      platform: 'mac';
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
