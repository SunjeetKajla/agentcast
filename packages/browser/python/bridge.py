"""Fixed Browser Harness operations; no model-supplied code is evaluated."""
import sys, os, json, base64, contextlib, time
from importlib.metadata import version
if version('browser-harness') != '0.1.13':
    raise RuntimeError('Run pnpm --filter @agentcast/browser setup (browser-harness 0.1.13 required)')
from browser_harness.admin import ensure_daemon, restart_daemon
from browser_harness.helpers import cdp, js, goto_url

# IDs change on each observation. Secret fields are excluded before the model sees the DOM.
OBSERVE = r'''(() => {
 if(!document.body || !/^https?:$/.test(location.protocol)) return null;
 const visible = el => {const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
 const secret = el => el.type==='password'||/pass(word|code|phrase)|\botp\b|secret|token|api.?key|cvv|card.?number/i.test([el.name,el.id,el.autocomplete,el.getAttribute('aria-label'),el.placeholder].join(' '));
 const seq=__AGENTCAST_SEQUENCE__;
 document.querySelectorAll('[data-agentcast-target]').forEach(e=>e.removeAttribute('data-agentcast-target'));
 const all=[...document.querySelectorAll('a,button,input,textarea,select,summary,[role],[tabindex]')].filter(visible).slice(0,300);
 const name = e => {
  const refs=(e.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();
  return (refs||e.getAttribute('aria-label')||[...(e.labels||[])].map(x=>x.innerText).join(' ')||e.getAttribute('alt')||e.title||(/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)?'':e.innerText)||'').trim().replace(/\s+/g,' ').slice(0,160);
 };
 const targets=all.filter(e=>!secret(e)).map((e,i)=>{
  const id=`o${seq}-${i}`;e.setAttribute('data-agentcast-target',id);
  const tag=e.tagName.toLowerCase();const role=e.getAttribute('role')||({a:'link',button:'button',textarea:'textbox',select:'combobox',input:['checkbox','radio'].includes(e.type)?e.type:e.type==='search'?'searchbox':'textbox',summary:'button'}[tag])||'other';
  const region=e.closest('dialog,[role="dialog"],tr,[role="row"],article,section,li,[role="tabpanel"]');
  const heading=region?.querySelector('h1,h2,h3,h4,[role="heading"]');
  const near=heading&&heading!==e?(heading.textContent||'').trim().replace(/\s+/g,' ').slice(0,160):undefined;
  const r=e.getBoundingClientRect();
  return {id,role,text:name(e),label:[...(e.labels||[])].map(x=>x.innerText).join(' ').trim().slice(0,160),placeholder:e.placeholder||'',near,inViewport:r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth,href:tag==='a'?e.href:undefined,options:tag==='select'?[...e.options].map(x=>({value:x.value,text:x.text})):undefined};
 });
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;const parts=[];let size=0;
 while((n=walker.nextNode())&&size<12000){const e=n.parentElement;if(!e||!visible(e)||e.closest('script,style,noscript,textarea,input,[contenteditable="true"]'))continue;const t=n.textContent.trim();if(t){parts.push(t);size+=t.length}}
 return {url:location.origin+location.pathname+location.hash.split('?')[0],title:document.title,text:parts.join('\n').slice(0,12000),targets,hasSecretFields:all.some(secret)};
})()'''

observation_sequence = 0

def dispatch(req):
    global observation_sequence
    op=req['op']
    if op=='init':
        ensure_daemon(wait=15)
        return {'ready':True}
    if op=='close':
        restart_daemon()
        return {'closed':True}
    if op=='observe':
        deadline = time.monotonic() + 15
        while True:
            observation_sequence += 1
            try:
                state=js(OBSERVE.replace('__AGENTCAST_SEQUENCE__',str(observation_sequence)))
            except RuntimeError as exc:
                # A committed navigation can replace the execution context while observing.
                if not any(word in str(exc).lower() for word in ('context was destroyed', 'cannot find context', 'execution context')):
                    raise
                state=None
            if state is not None:
                break
            if time.monotonic() >= deadline:
                raise TimeoutError('The page did not produce a readable document body within 15 seconds')
            time.sleep(0.1)
        # Don't attach a screenshot of a visible credential form to an LLM.
        if req.get('screenshot', True) and not state['hasSecretFields']:
            state['image']=cdp('Page.captureScreenshot',format='png').get('data')
        return state
    if op=='navigate':
        result=goto_url(req['url'])
        if result.get('errorText'):
            raise RuntimeError('Page navigation failed: '+result['errorText'])
        return {'ok':True}
    raise ValueError('Unknown operation')

try:
    for line in sys.stdin:
        try:
            req=json.loads(line)
            with contextlib.redirect_stdout(sys.stderr): result=dispatch(req)
            print(json.dumps({'result':result}),flush=True)
        except Exception as exc:
            print(json.dumps({'error':str(exc)[:300]}),flush=True)
finally:
    with contextlib.suppress(Exception):
        with contextlib.redirect_stdout(sys.stderr): restart_daemon()
