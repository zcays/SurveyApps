/* Package a separately frozen Intel Python engine without replacing ARM resources. */
const path=require('node:path'),fs=require('node:fs');
const {build,Platform,Arch}=require('electron-builder');
const root=path.join(__dirname,'..');
const config=require('../package.json').build;
const configPath=path.join(root,'build/intel-builder.json');
fs.writeFileSync(configPath,JSON.stringify({...config,extraResources:[{from:'build/backend-x64/surveyapps-backend',to:'backend'}]},null,2));
build({projectDir:root,targets:Platform.MAC.createTarget(['dmg','zip'],Arch.x64),publish:'never',config:configPath}).catch(error=>{console.error(error);process.exitCode=1;});
