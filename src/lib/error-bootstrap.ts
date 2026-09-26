/**
 * Bundle-independent client error reporter.
 *
 * Generates a tiny inline <script> that runs before any application bundle
 * loads. It exists because the root error boundary's own telemetry lives
 * inside the app bundle: if the crash happens during chunk loading or before
 * React boots, that telemetry can never fire (chicken-and-egg). This script
 * has zero dependencies and reports via fetch + keepalive directly to
 * PostgREST, so it works even when the app bundle is broken.
 *
 * Caps itself at 5 reports per page load. Never throws.
 */
export function errorBootstrapScript(
  supabaseUrl: string,
  publishableKey: string,
): string {
  const endpoint = JSON.stringify(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/client_errors`,
  );
  const key = JSON.stringify(publishableKey);
  return `(function(){try{var ENDPOINT=${endpoint};var KEY=${key};var n=0;
function send(m,s){if(n>=5)return;n++;try{fetch(ENDPOINT,{method:"POST",headers:{"apikey":KEY,"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify({message:String(m).slice(0,1000),stack:s?String(s).slice(0,4000):null,route:location.pathname.slice(0,200),user_agent:navigator.userAgent.slice(0,300)}),keepalive:true}).catch(function(){})}catch(e){}}
window.addEventListener("error",function(ev){try{var t=ev.target&&ev.target!==window?ev.target:null;var r=(t&&(t.src||t.href))||"";var er=ev.error;send((ev.message||"window.onerror")+(r?" @ "+r:""),er&&er.stack)}catch(e){}},true);
window.addEventListener("unhandledrejection",function(ev){try{var r=ev.reason;var em=r instanceof Error?r.message:String(r);send("unhandledrejection: "+em,r instanceof Error?r.stack:void 0)}catch(e){}});
}catch(e){}})();`;
}
