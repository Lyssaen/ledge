/* SVG factory reused from the approved visual direction study. */
window.LedgeMascotSVG = (() => {
 let uid=0;
 const names={claude:"Otto",codex:"Nova",cursor:"Pim"};
 const tools={claude:"Claude Code",codex:"Codex",cursor:"Cursor Agent"};
 const states=Object.fromEntries(Object.entries({starting:"Démarrage",working:"Au travail",waiting_permission:"Votre accord",waiting_input:"Une question",idle:"Disponible",error:"Erreur",exited:"Terminée"}).map(([key,label])=>[key,{label}]));
  function hash(str){return [...str].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7)}
  function botMarkup(tool,state,size,seed){
    const id=++uid, h=hash(seed||names[tool]), small=size<=20;
    const shell=tool==='codex'?'<ellipse class="shell" cx="48" cy="49" rx="32" ry="31" fill="url(#shell-'+id+')"/>':tool==='cursor'?'<path class="shell" d="M23 77 Q14 78 17 66 L30 22 Q33 12 42 20 L79 54 Q88 63 77 67 L58 71 46 83 Q40 88 36 80 L32 73Z" fill="url(#shell-'+id+')"/>':'<rect class="shell" x="15" y="22" width="66" height="56" rx="20" fill="url(#shell-'+id+')"/>';
    return '<svg class="bot" role="img" aria-label="'+tools[tool]+' · '+states[state].label+'" width="'+size+'" height="'+size+'" viewBox="'+(small?'12 16 72 68':'0 0 96 96')+'" data-tool="'+tool+'" data-state="'+state+'" data-small="'+small+'" data-seed="'+h+'" style="--phase:-'+(h%43)/10+'s;--breath:'+(4.8+h%17/10)+'s"><defs><linearGradient id="shell-'+id+'" x1=".2" y1="0" x2=".75" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="var(--shell-top)"/><stop offset="1" stop-color="var(--shell-bottom)"/></linearGradient></defs><ellipse class="ground" cx="48" cy="88" rx="25" ry="3"/><g class="body"><g class="pose"><g class="antenna-group"><path class="antenna" d="M49 22V14"/><circle class="antenna-light" cx="49" cy="12" r="3"/></g><g class="feet"><rect x="29" y="75" width="13" height="8" rx="4"/><rect x="54" y="75" width="13" height="8" rx="4"/></g>'+shell+'<path class="shine" d="'+(tool==='codex'?'M25 32Q35 19 51 22':tool==='cursor'?'M27 41 34 24Q35 23 37 25':'M25 36Q27 28 38 28H59')+'"/><rect class="visor" x="25" y="35" width="47" height="29" rx="13"/><path class="reflection" d="M39 37H60Q68 37 69 44H28Q29 37 39 37"/><g class="gaze"><g class="eye-blink"><g class="eye-open"><rect x="36" y="43" width="6" height="12" rx="3"/><rect x="55" y="43" width="6" height="12" rx="3"/></g><path class="eye-happy" d="M35 51Q39 43 43 51M54 51Q58 43 62 51"/><path class="eye-error" d="m35 45 8 3m11 0 8-3M38 54h2m16 0h2"/><path class="eye-sleep" d="M35 50q4 3 8 0m11 0q4 3 8 0"/></g></g><ellipse class="arm" cx="79" cy="63" rx="5" ry="8"/></g></g></svg>';
  }

return botMarkup;
})();

