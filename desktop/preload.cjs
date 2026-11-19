const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('macRemote', {
  platform: 'mac',
  authSession: (service, value) => ipcRenderer.invoke('remote:auth-session', service, value),
  identity: scope => ipcRenderer.invoke('remote:identity', scope),
  sign: (scope, message) => ipcRenderer.invoke('remote:sign', scope, message),
  pins: scope => ipcRenderer.invoke('remote:pins', scope),
  pin: (scope, id, pin) => ipcRenderer.invoke('remote:pin', scope, id, pin),
  info: () => ipcRenderer.invoke('remote:info'),
  sources: () => ipcRenderer.invoke('remote:sources'),
  selectDisplay: id => ipcRenderer.invoke('remote:select-display', id),
  approve: id => ipcRenderer.invoke('remote:approve', id),
  end: () => ipcRenderer.invoke('remote:end'),
  command: (sessionId, command) => ipcRenderer.invoke('remote:command', sessionId, command),
  permissions: prompt => ipcRenderer.invoke('remote:permissions', prompt),
  onDriver: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('remote:driver', handler);
    return () => ipcRenderer.removeListener('remote:driver', handler);
  },
});
