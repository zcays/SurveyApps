/* SurveyApps! desktop host. Owns local resources, window, IPC and process lifecycle. */
const {app, BrowserWindow, protocol, net, ipcMain, session, Menu, dialog} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {Backend} = require('./backend.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'surveyapps', privileges:{standard:true, secure:true, supportFetchAPI:true, corsEnabled:true}}]);
app.setName('SurveyApps!');
let window, backend, quitting=false;
const root = path.join(__dirname,'..');
const home = 'surveyapps://app/renderer/index.html';
const status = () => ({...backend.status, gridUrl:'surveyapps://app/vendor/grid-studio/index.html', version:app.getVersion()});
const validSender = event => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === home;
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(async()=>{
    backend = new Backend({root, resources:process.resourcesPath, packaged:app.isPackaged});
    protocol.handle('surveyapps', request => {
      const url = new URL(request.url);
      let file;
      try {file=path.resolve(root, '.'+decodeURIComponent(url.pathname));} catch {return new Response('Bad path',{status:400});}
      const relative=path.relative(root,file).split(path.sep).join('/');
      if (url.host !== 'app' || !['renderer/','assets/','vendor/grid-studio/'].some(prefix=>relative.startsWith(prefix)) || relative.includes('../')) return new Response('Forbidden',{status:403});
      try {
        const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'}[path.extname(file)] || 'application/octet-stream';
        return new Response(fs.readFileSync(file),{headers:{'Content-Type':mime,'Cache-Control':'no-store'}});
      } catch {return new Response('Not found',{status:404});}
    });
    session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
      const url = new URL(details.url);
      const allowed = url.protocol === 'surveyapps:' || url.protocol === 'data:' || url.protocol === 'blob:' || (backend.origin && url.origin === backend.origin);
      callback({cancel:!allowed});
    });
    session.defaultSession.webRequest.onBeforeSendHeaders((details,callback)=>{
      const headers={...details.requestHeaders};
      if(backend.origin && new URL(details.url).origin===backend.origin) headers['X-SurveyApps-Key']=backend.token;
      callback({requestHeaders:headers});
    });
    session.defaultSession.on('will-download',(_event,item)=>{
      const name=path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1F]/g,'_') || 'export';
      item.setSaveDialogOptions({title:'Save SurveyApps! export',defaultPath:path.join(app.getPath('downloads'),name)});
    });
    ipcMain.handle('surveyapps:status',event=>{if(!validSender(event))throw new Error('Denied');return status();});
    ipcMain.handle('surveyapps:retry',event=>{if(!validSender(event))throw new Error('Denied');if(backend.status.state==='error')backend.start();});
    backend.on('status',()=>{if(window&&!window.isDestroyed())window.webContents.send('surveyapps:status',status());});
    const menu=[
      ...(process.platform==='darwin'?[{label:'SurveyApps!',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}]:[]),
      {label:'File',submenu:[{label:'Home',accelerator:'CmdOrCtrl+1',click:()=>window.webContents.executeJavaScript("document.querySelector('[data-nav=home]').click()")},{type:'separator'},process.platform==='darwin'?{role:'close'}:{role:'quit'}]},
      {role:'editMenu'},
      {label:'View',submenu:[{role:'reload'},{role:'forceReload'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},
      {label:'Help',submenu:[{label:'Help & Reference',click:()=>window.webContents.executeJavaScript("document.querySelector('[data-nav=help]').click()")},{label:'About SurveyApps!',click:()=>dialog.showMessageBox(window,{type:'info',title:'SurveyApps!',message:'SurveyApps! '+app.getVersion(),detail:'Offline Grid Studio and Fluorescence Lab. Images remain on this computer. This local build is not Developer ID signed or notarized.'})}]}
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
    window=new BrowserWindow({width:1440,height:960,minWidth:800,minHeight:600,title:'SurveyApps!',backgroundColor:'#091423',icon:path.join(root,'assets/icon.png'),show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,url)=>{if(url!==home)event.preventDefault();});
    window.webContents.on('will-frame-navigate',(event,details)=>{
      // Electron versions expose details either as second arg or on the event.
      const target=typeof details==='string'?details:(details?.url || event.url);
      if(!target)return;
      const url=new URL(target);
      if(url.protocol!=='surveyapps:' && url.origin!==backend.origin && url.protocol!=='about:')event.preventDefault();
    });
    window.once('ready-to-show',()=>window.show());
    window.webContents.on('render-process-gone',()=>dialog.showMessageBox(window,{type:'error',message:'The workspace stopped responding.',detail:'Close and reopen SurveyApps! to start a fresh session.'}));
    await window.loadURL(home);
    backend.start();
  }).catch(error=>{dialog.showErrorBox('SurveyApps! startup error',error.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{if(!quitting){quitting=true;backend?.stop();}});
  process.on('exit',()=>backend?.stop());
}
