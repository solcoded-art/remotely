const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('macRemote', {
  platform: 'mac',
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
