/* Owns exactly one frozen Python process, session credential and startup state. */
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const http = require('node:http');

class Backend extends EventEmitter {
  constructor({ root, resources, packaged }) {
    super();
    this.root = root; this.resources = resources; this.packaged = packaged;
    this.child = null; this.origin = null; this.token = null;
    this.status = {state:'starting', message:'Starting Fluorescence Lab…'};
  }
  update(status) { this.status = status; this.emit('status', status); }
  start() {
    this.stop();
    this.token = randomBytes(32).toString('hex');
    this.update({state:'starting', message:'Starting Fluorescence Lab… Grid Studio is ready.'});
    const executable = process.platform === 'win32' ? 'surveyapps-backend.exe' : 'surveyapps-backend';
    const command = path.join(this.packaged ? this.resources : path.join(this.root,'build'), 'backend', ...(this.packaged ? [] : ['surveyapps-backend']), executable);
    const env = {...process.env, PYTHONUNBUFFERED:'1', PYTHONDONTWRITEBYTECODE:'1'};
    delete env.PYTHONPATH; delete env.PYTHONHOME;
    const child = spawn(command, [], {stdio:['pipe','pipe','pipe'], windowsHide:true, env});
    this.child = child;
    let buffer = '', diagnostic = '', ready = false;
    const failure = message => {
      if (this.child !== child) return;
      this.stop();
      this.update({state:'error', message});
    };
    const timer = setTimeout(() => failure('Fluorescence Lab took too long to start. Retry, or reopen SurveyApps!.'), 60000);
    this.timer = timer;
    child.on('error', error => failure('The bundled analysis engine could not start (' + error.code + '). Reinstall the complete application and retry.'));
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-5000); });
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 100000) return failure('Unexpected response from the analysis engine.');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,index); buffer = buffer.slice(index+1);
        let info; try {info=JSON.parse(line);} catch {continue;}
        if (info.event !== 'ready' || ready || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535) continue;
        ready = true;
        const origin = 'http://127.0.0.1:' + info.port;
        const request = http.get(origin+'/health', {headers:{'X-SurveyApps-Key':this.token}, timeout:5000}, response => {
          response.resume();
          if (this.child !== child) return;
          if (response.statusCode !== 200) return failure('Analysis engine health check failed. Please retry.');
          clearTimeout(timer); this.origin = origin;
          this.update({state:'ready',message:'Both tools are ready. Your images stay on this computer.',microscopyUrl:origin+'/'});
        });
        request.on('timeout',()=>request.destroy(new Error('timeout')));
        request.on('error',()=>failure('Could not connect to the local analysis engine. Please retry.'));
      }
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      // Diagnostics are local developer console only; no user image data is logged.
      if (diagnostic) console.error('Analysis engine:', diagnostic);
      failure('Fluorescence Lab stopped unexpectedly ('+(signal || code)+'). Grid Studio is still available. Retry to start a new analysis session.');
    });
    child.stdin.write(JSON.stringify({token:this.token})+'\n');
  }
  stop() {
    clearTimeout(this.timer);
    const child = this.child;
    this.child = null; this.origin = null;
    if (!child) return;
    child.stdin.end('shutdown\n');
    // EOF handles parent crashes too. Terminate a stuck import/request on normal quit.
    if (child.exitCode === null) child.kill();
    const timer = setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');}, 1500);
    timer.unref();
  }
}
module.exports = {Backend};
