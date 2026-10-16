import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Badge } from '../../../apps/overlay/src/ui/Badge';
import { Tabs } from '../../../apps/overlay/src/ui/Tabs';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { LangProvider } from '../../../apps/overlay/src/i18n/lang';
import { ChatView } from '../../../apps/overlay/src/surface/ChatView';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import type { ChatTurn, Session } from '../../../packages/protocol/src/index';
import { TableTop, Plant } from './office';
import { Plants } from './decor';
import { SessionList } from './list';
import { LaunchComposer, type LaunchRequest } from './launch';
import { ProjectEditor, INITIAL_PROJECTS, makeProject, proposeFromChat, basename, type Draft, type Proposal, type Project } from './projects';
import { SettingsPage, sectionLabel, gearIcon, DEFAULT_PREFS, INITIAL_MACHINES, INITIAL_RULES, type SectionId, type MachineEntry } from './settings';
import { SessionPage } from './session';
import { THREADS, fallbackThread, type Thread } from './sessions-data';
import { applyAccent } from '../../../apps/overlay/src/accent';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';

type Agent = { id:string; name:string; tool:'claude'|'codex'|'cursor'; project:string; state:BotState; task:string; machine:string; repos:string; parent?:string; offline?:boolean; reply:string; since?:number };
const projects=[{id:'ledge',name:'Ledge',repos:'application · documentation',branch:'desktop',note:'Une nouvelle façon de travailler avec vos agents.'},{id:'commerce',name:'Payment Service',repos:'api · storefront',branch:'checkout',note:'Paiement et migration des données.'},{id:'studio',name:'Paper Channel',repos:'portfolio',branch:'main',note:'Identité visuelle et portfolio.'},{id:'atlas',name:'Software Factory',repos:'pipelines · entrepôt',branch:'nightly',note:'Données et rapports quotidiens.'},{id:'mobile',name:'Doccle Channel',repos:'app · api',branch:'offline-mode',note:'Application iOS et Android.'},{id:'docs',name:'UI Migration',repos:'site · guides',branch:'main',note:'Site public et guides.'}];
const initial:Agent[]=[
 {id:'otto',since:4,name:'Otto',tool:'claude',project:'ledge',state:'approval',task:'Concevoir la navigation desktop',machine:'PC local',repos:'application · documentation',reply:'Le plan de navigation est prêt. Les projets regroupent les conversations ; chaque conversation retrouve son terminal à côté. Je te propose de valider ce découpage avant de poursuivre.'},
 {id:'pip',since:1,name:'Pip',tool:'claude',project:'ledge',state:'working',task:'Relire les parcours',machine:'PC local',repos:'documentation',parent:'otto',reply:'Je relis le parcours de création de tâche et celui de reprise d’une conversation. Je transmettrai mes observations à Otto.'},
 {id:'lya',since:6,name:'Lya',tool:'claude',project:'ledge',state:'working',task:'Vérifier l’accessibilité clavier',machine:'PC local',repos:'application',parent:'otto',reply:'Je parcours chaque écran au clavier seul et je note les pièges de focus.'},
 {id:'gus',since:25,name:'Gus',tool:'codex',project:'ledge',state:'done',task:'Mesurer le temps de chargement',machine:'PC local',repos:'application',parent:'otto',reply:'L’atelier s’affiche en 180 ms avec 30 agents. Rapport transmis à Otto.'},
 {id:'milo',since:2,name:'Milo',tool:'codex',project:'ledge',state:'working',task:'Fiabiliser les connexions SSH',machine:'Dev SSH',repos:'application',reply:'Je vérifie que les événements retrouvent la bonne session après une reconnexion SSH.'},
 {id:'bit',since:38,name:'Bit',tool:'codex',project:'ledge',state:'done',task:'Vérifier la reconnexion',machine:'Dev SSH',repos:'application',parent:'milo',reply:'La vérification est terminée. Mon rapport a été transmis à Milo.'},
 {id:'rio',since:6,name:'Rio',tool:'claude',project:'ledge',state:'approval',task:'Préparer la version 0.6',machine:'PC local',repos:'application',reply:'Le plan de la version 0.6.0 est prêt. Je n’ai rien modifié : peux-tu l’approuver ?'},
 {id:'nova',since:7,name:'Nova',tool:'codex',project:'commerce',state:'question',task:'Préparer la migration',machine:'Dev SSH',repos:'api',reply:'Préférerais-tu une migration progressive ou une courte fenêtre de maintenance ?'},
 {id:'echo',since:3,name:'Echo',tool:'codex',project:'commerce',state:'working',task:'Relire le schéma',machine:'Dev SSH',repos:'api',parent:'nova',reply:'Je vérifie les contraintes du schéma et les données à convertir.'},
 {id:'kim',since:5,name:'Kim',tool:'codex',project:'commerce',state:'question',task:'Préparer le retour arrière',machine:'Dev SSH',repos:'api',parent:'nova',reply:'Faut-il garder une copie de la table orders avant la migration, ou le snapshot de la nuit suffit-il ?'},
 {id:'iris',since:1,name:'Iris',tool:'cursor',project:'commerce',state:'working',task:'Adapter le paiement',machine:'Dev SSH',repos:'storefront · api',reply:'J’aligne les erreurs du formulaire sur les réponses de l’API.'},
 {id:'sage',since:52,name:'Sage',tool:'claude',project:'commerce',state:'done',task:'Corriger le calcul de la TVA',machine:'PC local',repos:'api',reply:'Le calcul arrondit désormais par ligne, comme l’exige la facturation. Les tests passent.'},
 {id:'luna',since:5,name:'Luna',tool:'claude',project:'studio',state:'working',task:'Décliner la nouvelle identité',machine:'PC local',repos:'portfolio',reply:'Je travaille sur les titres et les espacements de la page projets.'},
 {id:'kit',since:2,name:'Kit',tool:'claude',project:'',state:'working',task:'Trier les captures d’écran',machine:'PC local',repos:'~/Téléchargements',reply:'Je classe les captures par date et je supprime les doublons. Aucun dépôt Git n’est ouvert dans ce dossier.'},
 {id:'zed',since:3,name:'Zed',tool:'cursor',project:'',state:'question',task:'Nettoyer les journaux du serveur',machine:'Dev SSH',repos:'/var/log',reply:'Je peux supprimer les journaux de plus de 30 jours. Dois-je aussi archiver ceux du mois dernier ?'},
 {id:'ash',since:95,name:'Ash',tool:'cursor',project:'studio',state:'working',task:'Vérifier la version distante',machine:'Studio SSH',repos:'portfolio',offline:true,reply:'Connexion perdue. Dernier état connu : vérification en cours. L’activité actuelle n’est pas connue.'},
 {id:'juno',since:140,name:'Juno',tool:'codex',project:'studio',state:'working',task:'Optimiser les images',machine:'Studio SSH',repos:'portfolio',offline:true,reply:'Connexion perdue. Dernier état connu : conversion des images en AVIF.'},
 {id:'remy',since:12,name:'Remy',tool:'claude',project:'studio',state:'approval',task:'Publier la page À propos',machine:'PC local',repos:'portfolio',reply:'La page À propos est prête. Puis-je la publier sur le site de production ?'},
 {id:'vega',since:1,name:'Vega',tool:'claude',project:'atlas',state:'working',task:'Réécrire l’import des ventes',machine:'Dev SSH',repos:'pipelines',reply:'Je remplace l’import nocturne par un chargement incrémental.'},
 {id:'dot',since:4,name:'Dot',tool:'claude',project:'atlas',state:'working',task:'Comparer les volumes',machine:'Dev SSH',repos:'entrepôt',parent:'vega',reply:'Je compare les volumes importés avec ceux de la semaine dernière.'},
 {id:'ari',since:3,name:'Ari',tool:'cursor',project:'atlas',state:'working',task:'Valider les index',machine:'Dev SSH',repos:'entrepôt',parent:'vega',reply:'Je compare les plans d’exécution avant et après les nouveaux index.'},
 {id:'zoe',since:40,name:'Zoé',tool:'claude',project:'atlas',state:'done',task:'Nettoyer les anciennes tables',machine:'Dev SSH',repos:'entrepôt',parent:'vega',reply:'Les quatre tables obsolètes sont archivées.'},
 {id:'orion',since:35,name:'Orion',tool:'codex',project:'atlas',state:'question',task:'Choisir le partitionnement',machine:'Dev SSH',repos:'entrepôt',reply:'Faut-il partitionner les ventes par jour ou par mois ? Le volume quotidien est d’environ 2 millions de lignes.'},
 {id:'tess',since:8,name:'Tess',tool:'cursor',project:'atlas',state:'working',task:'Tester les rapports',machine:'PC local',repos:'pipelines',reply:'Je vérifie que les rapports du matin restent identiques après la réécriture.'},
 {id:'wren',since:180,name:'Wren',tool:'codex',project:'atlas',state:'done',task:'Documenter les tables',machine:'Dev SSH',repos:'entrepôt',reply:'Chaque table de l’entrepôt a maintenant une description et un propriétaire.'},
 {id:'kai',since:3,name:'Kai',tool:'claude',project:'mobile',state:'working',task:'Ajouter le mode hors ligne',machine:'PC local',repos:'app',reply:'Je mets en cache les dernières données et je synchronise au retour du réseau.'},
 {id:'zip',since:2,name:'Zip',tool:'claude',project:'mobile',state:'working',task:'Explorer le cache',machine:'PC local',repos:'app',parent:'kai',reply:'Je mesure la taille du cache sur un compte réel.'},
 {id:'lou',since:21,name:'Lou',tool:'codex',project:'mobile',state:'approval',task:'Mettre à jour les dépendances',machine:'Dev SSH',repos:'app · api',reply:'Douze dépendances ont une mise à jour majeure. Puis-je lancer la mise à jour et les tests ?'},
 {id:'fox',since:64,name:'Fox',tool:'codex',project:'mobile',state:'done',task:'Lister les mises à jour',machine:'Dev SSH',repos:'app',parent:'lou',reply:'La liste des mises à jour est prête et transmise à Lou.'},
 {id:'max',since:11,name:'Max',tool:'cursor',project:'mobile',state:'working',task:'Corriger le clavier Android',machine:'PC local',repos:'app',reply:'Le clavier masque le champ de saisie sur certains téléphones ; je corrige le défilement.'},
 {id:'ivy',since:6,name:'Ivy',tool:'codex',project:'mobile',state:'working',task:'Réduire la taille de l’application',machine:'Dev SSH',repos:'app',reply:'Je retire les polices et les images inutilisées du paquet.'},
 {id:'bo',since:9,name:'Bo',tool:'cursor',project:'mobile',state:'question',task:'Choisir le texte des notifications',machine:'PC local',repos:'app',reply:'Préfères-tu « Nouveau message » ou le nom de l’expéditeur dans la notification ?'},
 {id:'ivo',since:9,name:'Ivo',tool:'codex',project:'mobile',state:'working',task:'Traduire l’application en néerlandais',machine:'Dev SSH',repos:'app',reply:'Je traduis les écrans de réglages et de connexion.'},
 {id:'nia',since:240,name:'Nia',tool:'claude',project:'mobile',state:'done',task:'Écrire les tests de synchro',machine:'PC local',repos:'api',reply:'Les tests de synchronisation couvrent maintenant les conflits d’édition.'}
];
/** Agents sit in a zigzag along the table, one step apart; each agent adds one step of table. */
const STEP=70,MAX_SEATS=6,END_SEATS=2;
/** The rug runs this far past each end of the table, leaving the bottom-left corner free for the project's label. */
const RUG_SIDE=130;
/** Free floor kept between the workspace's edges and the rugs (logical px, scaled with the zoom). */
const FLOOR_MARGIN=56;
const tableLength=(n:number)=>(Math.max(n,2)+1)*STEP;
const toolName=(a:Agent)=>({claude:'Claude Code',codex:'Codex',cursor:'Cursor Agent'}[a.tool]);
const needsAttention=(a:Agent)=>a.state==='approval'||a.state==='question';
const gridIcon=['M3 3h7v7H3z','M14 3h7v7h-7z','M3 14h7v7H3z','M14 14h7v7h-7z'];
const terminalIcon=['m4 6 5 6-5 6','M12 18h8'];
const machineIcon=['M3 4h18v12H3z','M12 16v4','M8 20h8'];
const chatIcon=['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z'];
const unassignedIcon=['M4 7h16v12H4z','M4 7l2-3h4l2 3','M9 13h6'];
const listIcon=['M8 6h13','M8 12h13','M8 18h13','M3.5 6h.01','M3.5 12h.01','M3.5 18h.01'];
const subagentsIcon=['M4 4h7v6H4z','M13 14h7v6h-7z','M7.5 10v7H13'];
const subagentsOffIcon=['M4 4h7v6H4z','M7.5 10v7H11','M14 15l5 5','M19 15l-5 5'];
const pauseIcon=['M9 5v14','M15 5v14'];
const playIcon=['M7 5l12 7-12 7z'];
const helpIcon=['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18','M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6','M12 17h.01'];
const collapseIcon=['M9 4v5H4','M15 4v5h5','M9 20v-5H4','M15 20v-5h5'];
const searchIcon=['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15','m16 16 5 5'];
const shortcutRows=[['Ctrl / ⌘ K','Rechercher et ouvrir une session'],['Ctrl ,','Ouvrir les réglages'],['Alt 1…9','Accès direct aux sessions principales'],['Alt ← / →','Session précédente / suivante'],['J / K ou ↓ / ↑','Parcourir les sessions (atelier ou liste)'],['F','Filtrer la liste'],['Entrée','Ouvrir la session sélectionnée'],['N','Nouvelle session'],['+ / −','Zoomer / dézoomer l’atelier'],['0','Ajuster l’atelier à l’écran'],['Ctrl + molette','Zoomer sous le pointeur'],['Espace + glisser','Déplacer la vue'],['/','Ouvrir le chat Ledge'],['R','Écrire une réponse à l’agent'],['Y / N','Autoriser / refuser la demande en attente'],['1…9','Choisir une réponse proposée'],['J / K','Fichier suivant / précédent (Modifications)'],['O','Afficher ou masquer le terminal'],['Ctrl Alt N','Créer une tâche'],['Échap','Fermer le panneau ou revenir à l’atelier'],['?','Afficher ces raccourcis']];

function App(){
 const [theme,setTheme]=useState<'dark'|'light'>('dark');
 const [agents,setAgents]=useState(initial);
 const [project,setProject]=useState('all');
 const [mode,setMode]=useState<'atelier'|'compact'>('atelier');
 const [helpers,setHelpers]=useState(true);
 const [paused,setPaused]=useState(false);
 const [immersive,setImmersive]=useState(false);
 const [selected,setSelected]=useState<string|null>(null);
 const [sent,setSent]=useState<Record<string,string[]>>({});
 const [drafts,setDrafts]=useState<Record<string,string>>({});
 const [command,setCommand]=useState('');
 const [logs,setLogs]=useState<Record<string,string[]>>({});
 const [modal,setModal]=useState<'launch'|'design'|'search'|'shortcuts'|'project'|null>(null);
 const [projects,setProjects]=useState<Project[]>(INITIAL_PROJECTS);
 const projectName=(id:string)=>projects.find(p=>p.id===id)?.name??'Sans projet';
 const [editor,setEditor]=useState<{initial:Draft|Proposal;mode:'new'|'edit';autoLedge?:boolean;startDelete?:boolean}|null>(null);
 const [proposals,setProposals]=useState<Record<string,Proposal>>({});
 const [roomMenu,setRoomMenu]=useState<string|null>(null);
 const [settings,setSettings]=useState<SectionId|null>(null);
 const [prefs,setPrefs]=useState(DEFAULT_PREFS);
 const [machineList,setMachineList]=useState<MachineEntry[]>(INITIAL_MACHINES);
 const [rules,setRules]=useState(INITIAL_RULES);
 const [chatOpen,setChatOpen]=useState(false);
 const [chatTurns,setChatTurns]=useState<ChatTurn[]>([]);
 const [search,setSearch]=useState('');
 const [searchIndex,setSearchIndex]=useState(0);
 const [focusedId,setFocusedId]=useState<string|null>(null);
 const [launchProject,setLaunchProject]=useState('ledge');
 const [notice,setNotice]=useState('');
 /** The terminal beside a conversation is optional; the choice is remembered for this viewer. */
 const [showTerminal,setShowTerminal]=useState(()=>{try{return localStorage.getItem('ledge-mock-terminal')==='1'}catch{return false}});
 const toggleTerminal=(on=!showTerminal)=>{setShowTerminal(on);try{localStorage.setItem('ledge-mock-terminal',on?'1':'0')}catch{}if(on)requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('[aria-label="Commande de démonstration"]')?.focus())};
 /** Session threads (simulated): they outlive the page, so a reply sent before leaving still lands. */
 const [threads,setThreads]=useState<Record<string,Thread>>(THREADS);
 const sessionKeys=React.useRef<((k:string)=>boolean)|null>(null);
 const [chatHover,setChatHover]=useState<string|null>(null);
 const [launchingQid,setLaunchingQid]=useState<string|null>(null);
 useEffect(()=>{document.documentElement.dataset.theme=theme},[theme]);
 /** The atelier zooms to the largest size at which every table fits the available space without scrolling, and fills it. */
 const [fit,setFit]=useState(1);
 /** Manual zoom set by the viewer (null = fitted to the space); the layout stays the fitted one, only the scale changes. */
 const manualZoom=React.useRef<number|null>(null);const [zoomLevel,setZoomLevel]=useState<number|null>(null);const refit=React.useRef<()=>void>(()=>{});
 React.useLayoutEffect(()=>{
  const scroll=document.querySelector<HTMLElement>('.overview-scroll');const shell=scroll?.querySelector<HTMLElement>('.office-shell');
  if(mode!=='atelier'||selected||!scroll||!shell){setFit(1);return}
  // The atelier tiles everything (Ledge's desk, the tables, "Sans projet") in one wrapping row set. Tables are wide and low:
  // try every number of rows, force it through the shell's width, and keep the arrangement that zooms the most.
  const fits=()=>scroll.scrollHeight<=scroll.clientHeight+1&&scroll.scrollWidth<=scroll.clientWidth+1;
  const tiles=()=>[...shell.querySelectorAll<HTMLElement>('.ledge-corner,.project-room,.empty-project,.unassigned-zone')].map(t=>t.classList.contains('project-room')?parseFloat(t.style.getPropertyValue('--room'))||560:t.classList.contains('ledge-corner')?230:420);
  const compute=()=>{for(const k of ['width','paddingInline','minHeight','maxWidth'] as const)shell.style[k]='';shell.style.zoom='1';const widths=tiles();const total=widths.reduce((a,b)=>a+b+12,0);let best={z:0.4,w:''};
   for(let k=1;k<=Math.max(1,widths.length);k++){let row=0,widest=0;const target=total/k;for(const w of widths){if(row>0&&row+w>target*1.12){widest=Math.max(widest,row);row=0}row+=w+12}widest=Math.max(widest,row);const gw=`${Math.ceil(widest+2*FLOOR_MARGIN)}px`;
    shell.style.maxWidth=gw;shell.style.marginInline='auto';let z=Math.min(1.8,(scroll.clientWidth-8)/(widest+2*FLOOR_MARGIN+16));for(;z>0.4;z-=0.02){shell.style.zoom=String(z);if(fits())break}if(z>best.z)best={z,w:gw}}
   shell.style.maxWidth=best.w;shell.style.zoom=String(best.z);
   // Then fill both axes: the floor spans the whole width (padding instead of a max width) and the leftover height.
   const z=best.z,gw=parseFloat(best.w);shell.style.maxWidth='';shell.style.paddingInline=`${Math.max(FLOOR_MARGIN,(shell.offsetWidth-gw)/2+FLOOR_MARGIN)}px`;if(!fits()){shell.style.paddingInline='';shell.style.maxWidth=best.w}
   const extra=scroll.scrollHeight-shell.getBoundingClientRect().height;shell.style.minHeight=`${Math.max(0,(scroll.clientHeight-extra-4)/z)}px`;
   if(!fits())shell.style.minHeight='';
   // Freeze the fitted layout's width so a manual zoom scales it (and overflows, to pan) instead of reflowing the rows.
   shell.style.width=`${shell.offsetWidth}px`;setFit(z);if(manualZoom.current)shell.style.zoom=String(manualZoom.current)};
  refit.current=compute;compute();window.addEventListener('resize',compute);return()=>{window.removeEventListener('resize',compute);for(const k of ['zoom','maxWidth','marginInline','paddingInline','minHeight','width'] as const)shell.style[k]=''};
 },[immersive,mode,selected,agents,helpers,project,chatOpen]);
 const viewEls=()=>{const scroll=document.querySelector<HTMLElement>('.overview-scroll.atelier');return {scroll,shell:scroll?.querySelector<HTMLElement>('.office-shell')}};
 /** Zooms around a point of the view (the pointer, or the centre), keeping that point still. */
 const zoomAt=(target:number,at?:{x:number;y:number})=>{const {scroll,shell}=viewEls();if(!scroll||!shell)return;const old=parseFloat(shell.style.zoom)||1;const z=Math.min(2.5,Math.max(0.3,target));
  const r=scroll.getBoundingClientRect();const mx=at?at.x-r.left:scroll.clientWidth/2,my=at?at.y-r.top:scroll.clientHeight/2;const px=(scroll.scrollLeft+mx)/old,py=(scroll.scrollTop+my)/old;
  shell.style.zoom=String(z);scroll.scrollLeft=px*z-mx;scroll.scrollTop=py*z-my;manualZoom.current=z;setZoomLevel(z)};
 const fitView=()=>{manualZoom.current=null;setZoomLevel(null);refit.current();const {scroll}=viewEls();scroll?.scrollTo({left:0,top:0})};
 /** Frames one element (a table): zoom so it fills most of the view, centred. */
 const zoomTo=(el:HTMLElement)=>{const {scroll,shell}=viewEls();if(!scroll||!shell)return;const old=parseFloat(shell.style.zoom)||1;const r=scroll.getBoundingClientRect(),e=el.getBoundingClientRect();
  const x=(scroll.scrollLeft+e.left-r.left)/old,y=(scroll.scrollTop+e.top-r.top)/old,w=e.width/old,h=e.height/old;const z=Math.min(2.2,Math.max(0.3,Math.min(scroll.clientWidth*0.92/w,scroll.clientHeight*0.92/h)));
  shell.style.zoom=String(z);scroll.scrollLeft=(x+w/2)*z-scroll.clientWidth/2;scroll.scrollTop=(y+h/2)*z-scroll.clientHeight/2;manualZoom.current=z;setZoomLevel(z)};
 const zoomStep=(dir:1|-1)=>{const {shell}=viewEls();zoomAt((parseFloat(shell?.style.zoom||'1')||1)*(dir>0?1.2:1/1.2))};
 // Ctrl/⌘ + wheel (and trackpad pinch) zooms at the pointer; dragging the floor pans; double-click frames a table or refits.
 useEffect(()=>{const {scroll}=viewEls();if(!scroll||mode!=='atelier'||selected)return;
  const interactive='button,a,input,textarea,select,label,[draggable="true"],.agent-seat,.unassigned-card,.room-heading,.ledge-desk,.zoom-controls';
  const wheel=(e:WheelEvent)=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const {shell}=viewEls();zoomAt((parseFloat(shell?.style.zoom||'1')||1)*Math.exp(-e.deltaY*0.0022),{x:e.clientX,y:e.clientY})};
  let pan:{x:number;y:number;l:number;t:number;id:number}|null=null;let space=false;
  const down=(e:PointerEvent)=>{const t=e.target as HTMLElement;if(!(e.button===1||space||(e.button===0&&!t.closest(interactive))))return;if(scroll.scrollWidth<=scroll.clientWidth&&scroll.scrollHeight<=scroll.clientHeight)return;
   e.preventDefault();pan={x:e.clientX,y:e.clientY,l:scroll.scrollLeft,t:scroll.scrollTop,id:e.pointerId};scroll.setPointerCapture(e.pointerId);scroll.classList.add('panning')};
  const move=(e:PointerEvent)=>{if(!pan)return;scroll.scrollLeft=pan.l-(e.clientX-pan.x);scroll.scrollTop=pan.t-(e.clientY-pan.y)};
  const up=()=>{if(!pan)return;scroll.releasePointerCapture(pan.id);pan=null;scroll.classList.remove('panning')};
  const dbl=(e:MouseEvent)=>{const t=e.target as HTMLElement;if(t.closest('button,a,input,textarea,.unassigned-card,.agent-seat'))return;const room=t.closest<HTMLElement>('.project-room');if(room)zoomTo(room);else fitView()};
  const keys=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(target.closest('input,textarea,select,[contenteditable=true]')||modal)return;const k=e.key;
   if(k===' '){e.preventDefault();if(!e.repeat){space=true;scroll.classList.add('can-pan')}return}
   if((k==='+'||k==='=')&&!e.altKey){e.preventDefault();zoomStep(1)}else if(k==='-'&&!e.altKey){e.preventDefault();zoomStep(-1)}else if(k==='0'&&!e.altKey){e.preventDefault();fitView()}};
  const keyup=(e:KeyboardEvent)=>{if(e.key===' '){space=false;scroll.classList.remove('can-pan')}};
  scroll.addEventListener('wheel',wheel,{passive:false});scroll.addEventListener('pointerdown',down);scroll.addEventListener('pointermove',move);scroll.addEventListener('pointerup',up);scroll.addEventListener('pointercancel',up);scroll.addEventListener('dblclick',dbl);window.addEventListener('keydown',keys);window.addEventListener('keyup',keyup);
  return()=>{scroll.removeEventListener('wheel',wheel);scroll.removeEventListener('pointerdown',down);scroll.removeEventListener('pointermove',move);scroll.removeEventListener('pointerup',up);scroll.removeEventListener('pointercancel',up);scroll.removeEventListener('dblclick',dbl);window.removeEventListener('keydown',keys);window.removeEventListener('keyup',keyup)};
 },[mode,selected,modal]);
 useEffect(()=>{applyAccent(prefs.accent,theme)},[prefs.accent,theme]);
 useEffect(()=>{setPaused(prefs.reduced)},[prefs.reduced]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),prefs.toastSeconds*1000);return()=>clearTimeout(t)},[notice]);
 useEffect(()=>{const onChange=()=>setImmersive(Boolean(document.fullscreenElement));document.addEventListener('fullscreenchange',onChange);return()=>document.removeEventListener('fullscreenchange',onChange)},[]);
 const current=agents.find(a=>a.id===selected);
 const inScope=(a:Agent)=>project==='all'||(a.project||'none')===project;
 const staffed=(id:string)=>agents.some(a=>a.project===id);
 /** A project without agents has no table: it only shows in the sidebar until a session starts there. */
 const visibleProjects=projects.filter(p=>(project==='all'||p.id===project)&&staffed(p.id));
 const emptyProject=project!=='all'&&project!=='none'&&!staffed(project)?projects.find(p=>p.id===project):undefined;
 const unassigned=agents.filter(a=>!a.project&&inScope(a));
 const [assigning,setAssigning]=useState<string|null>(null);
 const [dragging,setDragging]=useState<string|null>(null);
 const [dropOver,setDropOver]=useState<string|null>(null);
 const [seated,setSeated]=useState<string|null>(null);
 useEffect(()=>{if(!seated)return;const t=setTimeout(()=>setSeated(null),1600);return()=>clearTimeout(t)},[seated]);
 const dragProps=(a:Agent)=>({draggable:true,onDragStart:(e:React.DragEvent)=>{e.dataTransfer.setData('text/plain',a.id);e.dataTransfer.effectAllowed='move';setAssigning(null);setDragging(a.id)},onDragEnd:()=>{setDragging(null);setDropOver(null)}});
 const dropProps=(pid:string)=>({onDragOver:(e:React.DragEvent)=>{if(!dragging)return;e.preventDefault();e.dataTransfer.dropEffect='move';if(dropOver!==pid)setDropOver(pid)},onDragLeave:(e:React.DragEvent)=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropOver(o=>o===pid?null:o)},onDrop:(e:React.DragEvent)=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain')||dragging;if(id)assign(id,pid);setDragging(null);setDropOver(null)}});
 const assign=(id:string,to:string)=>{const moved=agents.find(a=>a.id===id)!;setSeated(id);setAgents([...agents.filter(a=>a.id!==id),{...moved,project:to}]);setAssigning(null);if(prefs.rememberFolders&&!moved.project)setRules(r=>[...r.filter(x=>!(x.folder===moved.repos&&x.machine===moved.machine)),{id:'r-'+Date.now(),folder:moved.repos,machine:moved.machine,project:to}]);setNotice(`${agents.find(a=>a.id===id)?.name} rejoint la table ${projectName(to)}.${prefs.rememberFolders&&!moved.project?' Ledge s’en souviendra pour ce dossier.':''}`)};
 const mainAgents=agents.filter(a=>!a.parent);
 const [listOrder,setListOrder]=useState<string[]>([]);
 const navigable=mode==='compact'&&!selected&&!settings?listOrder.map(id=>agents.find(a=>a.id===id)!).filter(Boolean):agents.filter(a=>inScope(a)&&(helpers||!a.parent));
 const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const searchResults=agents.filter(a=>normalized(`${a.name} ${a.task} ${toolName(a)} ${a.machine} ${a.project}`).includes(normalized(search)));
 const chatSessions:Session[]=agents.map(a=>({id:a.id,name:a.name,tool:a.tool,cwd:a.project?`/workspace/${a.project}`:a.repos,project:projectName(a.project),title:a.task,topic:a.task,repoId:a.project,machineName:a.machine,tmuxSession:a.id,state:a.offline?'error':a.state==='approval'?'waiting_permission':a.state==='question'?'waiting_input':a.state==='done'?'exited':'working',helpers:[],startedAt:new Date().toISOString(),lastActivityAt:new Date().toISOString(),source:'launcher'}));
 const bot=(a:Agent,size:number)=><Bot tool={a.tool} state={a.state} pose={1} size={size} theme={theme} seed={a.id} frozen={a.offline} paused={paused} />;
 const status=(a:Agent)=><Badge state={a.offline?'readonly':a.state} label={a.offline?'Hors ligne':undefined}/>;
 const goHome=(p='all')=>{setSelected(null);setSettings(null);setProject(p)};
 const draftOf=(p:Project):Draft=>({id:p.id,name:p.name,color:p.color,note:p.note,repos:p.repoList});
 const newProject=(o:{prefill?:Partial<Draft>;autoLedge?:boolean}={})=>{setRoomMenu(null);setAssigning(null);setEditor({mode:'new',initial:{name:'',color:'#ef4444',note:'',repos:[],...o.prefill},autoLedge:o.autoLedge});setModal('project')};
 const editProject=(id:string,startDelete=false)=>{const p=projects.find(x=>x.id===id);if(!p)return;setRoomMenu(null);setEditor({mode:'edit',initial:draftOf(p),startDelete});setModal('project')};
 const reviewProposal=(pr:Proposal)=>{setEditor({mode:pr.targetId||pr.id?'edit':'new',initial:pr});setModal('project')};
 const saveProject=(d:Draft)=>{const id=d.id||'p'+Date.now().toString(36);const old=projects.find(p=>p.id===id);const next=makeProject({id,name:d.name,color:d.color,note:d.note||old?.note||'',repoList:d.repos});
  setProjects(old?projects.map(p=>p.id===id?next:p):[...projects,next]);
  const filed=(d.agents||[]).map(a=>a.id);if(filed.length){setAgents(as=>as.map(a=>filed.includes(a.id)?{...a,project:id}:a));if(prefs.rememberFolders)setRules(r=>[...r,...agents.filter(a=>filed.includes(a.id)).map(a=>({id:'r-'+a.id+Date.now(),folder:a.repos,machine:a.machine,project:id}))])}
  setModal(null);setEditor(null);const staffedNow=filed.length>0||agents.some(a=>a.project===id);
  setNotice(old?`${next.name} enregistré.`:staffedNow?`Projet ${next.name} créé. ${filed.length?(d.agents||[]).map(a=>a.name).join(' et ')+' rejoignent sa table.':''}`:`Projet ${next.name} créé. Il apparaît dans la barre latérale ; sa table s’ouvrira avec la première session.`)};
 const deleteProject=(id:string,moveTo:string|null)=>{const p=projects.find(x=>x.id===id)!;const n=agents.filter(a=>a.project===id).length;
  setAgents(as=>as.map(a=>a.project===id?{...a,project:moveTo||''}:a));setRules(r=>moveTo?r.map(x=>x.project===id?{...x,project:moveTo}:x):r.filter(x=>x.project!==id));setProjects(ps=>ps.filter(x=>x.id!==id));
  if(project===id)setProject(moveTo||'all');if(launchProject===id)setLaunchProject(moveTo||projects.find(x=>x.id!==id)!.id);setModal(null);setEditor(null);
  setNotice(`${p.name} supprimé.${n?` ${n} agent${n>1?'s':''} ${moveTo?`rejoignent ${projectName(moveTo)}`:'passent dans « Sans projet »'}.`:''}`)};
 useEffect(()=>{if(!roomMenu)return;const close=(e:MouseEvent)=>{if(!(e.target as HTMLElement).closest('.room-menu-wrap'))setRoomMenu(null)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[roomMenu]);
 const openSettings=(s:SectionId='general')=>{setSettings(s);setModal(null);setChatOpen(false)};
 const machineOffline=(m:MachineEntry)=>{if(m.reachable===false)return true;const on=agents.filter(a=>a.machine===m.label);return on.length>0&&on.every(a=>a.offline)};
 const open=(id:string)=>{setSettings(null);setSelected(id);setFocusedId(id);setCommand('');setModal(null);setChatOpen(false)};
 const openSearch=()=>{setSearch('');setSearchIndex(0);setModal('search')};
 const openChat=()=>{setChatOpen(true);requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('[data-chat-input]')?.focus())};
 const fullScreen=async()=>{if(document.fullscreenElement){await document.exitFullscreen();return}if(immersive){setImmersive(false);return}try{await document.documentElement.requestFullscreen()}catch{setImmersive(true)}};
 const machines=machineList.map(m=>({name:m.label,kind:m.ssh?'Connexion SSH':'Daemon local',online:!machineOffline(m)}));
 const launch=(pid?:string)=>{setLaunchProject(pid||(project==='all'||project==='none'?'ledge':project));setChatOpen(c=>c);setModal('launch')};
 const startAgent=(r:LaunchRequest)=>{const id='demo-'+Date.now();const a:Agent={id,name:r.name,tool:r.tool,project:r.project,state:'starting',task:r.prompt,machine:r.machine,repos:r.repos.join(' · '),reply:'La session vient de démarrer dans cette maquette. Aucun harnais réel n’a été lancé.'};
  setAgents(prev=>[...prev,a]);setSeated(id);setModal(null);setSelected(null);if(project!=='all'&&project!==r.project)setProject('all');
  setTimeout(()=>setAgents(prev=>prev.map(x=>x.id===id?{...x,state:'working'}:x)),2600);
  setTimeout(()=>document.querySelector(`[data-agent="${id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'}),80);
  setNotice(`${r.name} démarre à la table ${projectName(r.project)}.`);return id};
 const send=(e:React.FormEvent)=>{e.preventDefault();if(!current||!drafts[current.id]?.trim())return;setSent({...sent,[current.id]:[...(sent[current.id]||[]),drafts[current.id]]});setDrafts({...drafts,[current.id]:''});setNotice('Message ajouté à la simulation.')};
 const decide=(label:string)=>{if(!current)return;setAgents(agents.map(a=>a.id===current.id?{...a,state:'working',reply:'La réponse a été prise en compte dans cette simulation. L’agent reprend son travail.'}:a));setSent({...sent,[current.id]:[...(sent[current.id]||[]),label]});setNotice('Décision simulée. Aucun agent réel n’a été contacté.')};
 /** Quick answer from the Liste: the agent resumes, as `decide` does inside the session. */
 const quickDecide=(id:string,ok:boolean)=>{const a=agents.find(x=>x.id===id);if(!a)return;setAgents(as=>as.map(x=>x.id===id?{...x,state:'working',since:0,reply:ok?'Autorisation reçue. Je poursuis.':'Refus reçu. Je cherche une autre façon de faire, sans cette action.'}:x));setSent(m=>({...m,[id]:[...(m[id]||[]),ok?'Autorisé depuis la liste.':'Refusé depuis la liste.']}));setNotice(`${a.name} : ${ok?'autorisation accordée':'demande refusée'}. Décision simulée, aucun agent réel contacté.`)};
 const askLedge=(question:string)=>{
  const q=normalized(question);
  const prop=proposeFromChat(question,projects,agents);
  if(prop){const now=new Date().toISOString();setProposals(m=>({...m,[prop.pid]:prop}));const target=prop.targetId?projects.find(p=>p.id===prop.targetId):undefined;const added=prop.repos.filter(r=>r.why);
   const answer=(target?`**${target.name}** existe déjà. Je propose d’y ajouter ${added.length} dépôt${added.length>1?'s':''}`:`Je propose un projet **${prop.name}** avec ${added.length} dépôt${added.length>1?'s':''}`)+(added.length?` : ${added.map(r=>`${basename(r.path)} (${r.machine})`).join(', ')}.`:'.')+(prop.agents?.length?` ${prop.agents.map(a=>a.name).join(' et ')} y seraient rangés.`:'')+`\n\n${prop.summary}\n\nRien n’est créé tant que vous ne validez pas.\n\n[Vérifier la proposition](ledge://project/${prop.pid})`;
   setChatTurns(prev=>[...prev,{qid:'demo-chat-'+Date.now(),question,askedAt:now,answeredAt:now,steps:[{kind:'sessions'}],answer}]);return}
  if(/\b(lance|lancer|demarre|demarrer)\b/.test(q)){const target=projects.find(p=>q.includes(normalized(p.name)))||projects.find(p=>p.id===project)||projects[0];const repo=target.repos.split(' · ')[0];const prompt=question.replace(/^.*?\b(pour|qui|afin de)\b\s*/i,'').replace(/[?.!]+$/,'')||undefined;const now=new Date().toISOString();
   setChatTurns(prev=>[...prev,{qid:'demo-chat-'+Date.now(),question,askedAt:now,answeredAt:now,steps:[{kind:'sessions'}],answer:`Je peux démarrer une session à la table **${target.name}**, dans le dépôt ${repo}. Vérifiez la consigne, puis lancez-la.`,proposal:{cwd:`~/${target.id}/${repo}`,project:target.name,prompt:prompt&&prompt[0].toUpperCase()+prompt.slice(1),tool:'claude'}}]);return}const mentions=agents.filter(a=>q.includes(normalized(a.name)));const matched=projects.find(p=>q.includes(normalized(p.name)));const scope=matched?agents.filter(a=>a.project===matched.id):agents;
  const list=mentions.length?mentions:/attend|bloqu|besoin|attention/.test(q)?scope.filter(needsAttention):scope.filter(a=>!a.parent);
  const answer='### État des sessions de démonstration\n\n'+(list.length?list.map(a=>`- **${a.name}** · ${a.task} — ${a.offline?'connexion perdue, activité actuelle inconnue':a.state==='approval'?'attend votre accord':a.state==='question'?'attend votre réponse':a.state==='done'?'terminé':'au travail'} (${a.machine}).`).join('\n'):'Aucun agent ne correspond à cette demande dans la simulation.')+'\n\nOuvrez un nom pour retrouver sa conversation et son terminal. Cette réponse est construite à partir des données fictives de la maquette.';
  const now=new Date().toISOString();setChatTurns(prev=>[...prev,{qid:'demo-chat-'+Date.now(),question,askedAt:now,answeredAt:now,steps:[{kind:'sessions'}],answer}]);
 };
 const launchProposal=(qid:string)=>{const turn=chatTurns.find(t=>t.qid===qid);const pr=turn?.proposal;if(!pr)return;setLaunchingQid(qid);
  setTimeout(()=>{const target=projects.find(p=>p.name===pr.project)!;const name=['Néo','Ada','Lux','Pia','Sol','Taz'].find(n=>!agents.some(a=>a.name===n))||'Néo';
   const id=startAgent({tool:pr.tool as Agent['tool'],prompt:pr.prompt||'Session ouverte depuis le chat',project:target.id,machine:'PC local',repos:[pr.cwd.split('/').pop()!],name});
   setChatTurns(prev=>prev.map(t=>t.qid===qid?{...t,proposal:{...t.proposal!,launchedId:id}}:t));setLaunchingQid(null)},700)};
 useEffect(()=>{if(!chatHover)return;const els=document.querySelectorAll(`.overview-scroll [data-agent="${chatHover}"]`);els.forEach(el=>el.classList.add('chat-hover'));return()=>els.forEach(el=>el.classList.remove('chat-hover'))},[chatHover]);
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{
   if(e.isComposing)return;const k=e.key.toLowerCase();const target=e.target as HTMLElement;const typing=Boolean(target.closest('input,textarea,select,[contenteditable=true]'));
   if((e.ctrlKey||e.metaKey)&&!e.altKey&&k==='k'){e.preventDefault();openSearch();return}
   if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key===','){e.preventDefault();openSettings();return}
   if(e.key==='Escape'){e.preventDefault();if(roomMenu)setRoomMenu(null);else if(modal)setModal(null);else if(chatOpen)setChatOpen(false);else if(settings)setSettings(null);else if(selected&&sessionKeys.current?.('escape'));else if(selected)setSelected(null);else if(project!=='all')goHome();else if(immersive&&!document.fullscreenElement)setImmersive(false);return}
   if(modal==='search'){if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setSearchIndex(i=>Math.max(0,Math.min(searchResults.length-1,i+(e.key==='ArrowDown'?1:-1))))}else if(e.key==='Enter'&&searchResults[searchIndex]){e.preventDefault();open(searchResults[searchIndex].id)}return}
   if(modal||typing||chatOpen)return;
   if(e.ctrlKey&&e.altKey&&k==='n'){e.preventDefault();launch();return}
   if(e.altKey&&!e.ctrlKey&&!e.metaKey){const index=Number(k)-1;if(/^[1-9]$/.test(k)&&mainAgents[index]){e.preventDefault();open(mainAgents[index].id);return}if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const i=navigable.findIndex(a=>a.id===(selected||focusedId));const step=e.key==='ArrowRight'?1:-1;const a=navigable[i<0?(step>0?0:navigable.length-1):(i+step+navigable.length)%navigable.length];if(a)open(a.id);return}}
   if(e.ctrlKey||e.metaKey||e.altKey)return;
   if(settings&&k!=='/'&&k!=='?')return;
   if(selected&&sessionKeys.current?.(k)){e.preventDefault();return}
   if(k==='/'){e.preventDefault();openChat()}else if(k==='n'&&!selected){e.preventDefault();launch()}else if(k==='?'){e.preventDefault();setModal('shortcuts')}else if(selected&&k==='r'){e.preventDefault();document.querySelector<HTMLInputElement>('[aria-label="Répondre à l’agent"]')?.focus()}else if(selected&&k==='o'){e.preventDefault();toggleTerminal()}else if(!selected&&['j','k','arrowdown','arrowup'].includes(k)&&!target.closest('[role=tablist]')){e.preventDefault();const i=navigable.findIndex(a=>a.id===focusedId);const step=['j','arrowdown'].includes(k)?1:-1;const a=navigable[i<0?(step>0?0:navigable.length-1):(i+step+navigable.length)%navigable.length];if(a){setFocusedId(a.id);document.querySelector<HTMLElement>(`[data-agent="${a.id}"]`)?.focus()}}else if(!selected&&e.key==='Enter'&&focusedId&&!target.closest('button,a')){e.preventDefault();open(focusedId)}
  };
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[roomMenu,settings,modal,chatOpen,selected,focusedId,searchResults,searchIndex,navigable,mainAgents,immersive,project,showTerminal]);
 return <LangProvider lang="fr"><div className={`prototype ${immersive?'immersive':''} ${dragging?'is-dragging':''}`}>
  <style>{projects.map(p=>`.swatch-${p.id}{background:${p.color}}.office-shell [data-project="${p.id}"] .office-rug{border-color:color-mix(in srgb,${p.color} 18%,var(--border));background:color-mix(in srgb,${p.color} 5%,var(--sidebar))}`).join('')}</style>
  <div className="study-bar"><span>Maquette interactive · Ledge desktop</span><span>Données simulées</span><button onClick={()=>setModal('design')}>Références du design system <Icon d={ICONS.external.d} size={12}/></button></div>
  <div className="application" inert={!!modal}>
   <aside className="sidebar">
    <div className="side-brand"><ResidentMascot size={30} theme={theme} paused={paused}/><strong>Ledge</strong><span className="spacer"/></div>
    <div className="side-actions"><Button variant="primary" onClick={()=>launch()}><Icon d={ICONS.plus.d}/><span>Nouvelle session</span><Kbd>N</Kbd></Button><button className="side-search" onClick={openSearch} aria-label="Rechercher une session"><Icon d={searchIcon} size={14}/><span>Rechercher</span><Kbd>Ctrl K</Kbd></button></div>
    <div className="side-scroll">
     <nav className="side-group" aria-label="Vues">
      <button className={`side-row ${!current&&!settings&&project==='all'?'active':''}`} onClick={()=>goHome()}><Icon d={gridIcon}/><span>Atelier</span><small>{agents.filter(a=>!a.parent&&!a.offline&&a.state!=='done').length}</small></button>
      <button className={`side-row ${chatOpen?'active':''}`} onClick={()=>chatOpen?setChatOpen(false):openChat()}><Icon d={chatIcon}/><span>Chat Ledge</span><Kbd>/</Kbd></button>
     </nav>
     <div className="side-group">
      <div className="side-label"><span>Projets</span><button aria-label="Nouveau projet" onClick={()=>newProject()}><Icon d={ICONS.plus.d} size={13}/></button></div>
      <nav aria-label="Projets">{projects.map(p=>{const team=agents.filter(a=>a.project===p.id&&!a.parent);return <button key={p.id} {...dropProps(p.id)} className={`side-row side-project ${project===p.id&&!current&&!settings?'active':''} ${dropOver===p.id?'drop-over':''}`} onClick={()=>goHome(p.id)}>
       <i className={`side-swatch swatch-${p.id}`}/><span>{p.name}</span><span className="side-dots" aria-label={`${team.length} agents`}>{team.slice(0,6).map(a=><i key={a.id} className={a.offline?'dot-offline':`dot-${a.state}`}/>)}</span></button>})}
       {agents.some(a=>!a.project)&&<button className={`side-row side-unassigned ${project==='none'&&!settings?'active':''}`} onClick={()=>goHome('none')}><Icon d={unassignedIcon}/><span>Sans projet</span><small>{agents.filter(a=>!a.project).length}</small>{agents.some(a=>!a.project&&needsAttention(a))&&<b className="side-alert"/>}</button>}
      </nav>
      {dragging&&<p className="side-drop-help">Déposez sur un projet pour y ranger {agents.find(a=>a.id===dragging)?.name}.</p>}
     </div>
     <div className="side-group">
      <div className="side-label"><span>Machines</span><button aria-label="Gérer les machines" onClick={()=>openSettings('machines')}><Icon d={ICONS.chevronRight.d} size={13}/></button></div>
      {machineList.map(mm=>{const m=mm.label;const on=agents.filter(a=>a.machine===m);const offline=machineOffline(mm);return <button key={mm.id} className={`side-row side-machine ${settings==='machines'?'active':''}`} onClick={()=>openSettings('machines')}><i className={`machine-dot ${offline?'off':''}`}/><span>{m}</span><small>{offline?'hors ligne':`${on.length} agent${on.length>1?'s':''}`}</small></button>})}
     </div>
    </div>
    <div className="side-footer"><button className={`side-row ${settings?'active':''}`} onClick={()=>settings?setSettings(null):openSettings()} aria-current={settings?'page':undefined}><Icon d={gearIcon}/><span>Réglages</span><Kbd>Ctrl ,</Kbd></button></div>
   </aside>
   <section className="workspace">
    <header className="app-header"><div className="breadcrumb"><Icon d={settings?gearIcon:current?ICONS.folder.d:gridIcon}/>{settings?<><button className="crumb-link" onClick={()=>openSettings('general')}>Réglages</button><span className="muted">/</span><strong>{sectionLabel(settings)}</strong></>:current?<><button className="crumb-link" onClick={()=>goHome()} title="Échap">{mode==='compact'?'Liste':'Atelier'}</button><span className="muted">/</span><button className="crumb-link" onClick={()=>goHome(current.project||'none')}>{projectName(current.project)}</button><span className="muted">/</span>{(()=>{const parent=agents.find(a=>a.id===current.parent);return parent&&<><button className="crumb-link crumb-parent" onClick={()=>open(parent.id)} title={`Ouvrir la conversation de ${parent.name}`}>{bot(parent,18)}{parent.name}</button><span className="muted">/</span></>})()}<span className="crumb-session">{bot(current,22)}<strong>{current.name}</strong><span className="crumb-task" title={current.task}>{current.task}</span></span></>:<>{project==='all'?<strong>{mode==='compact'?'Liste':'Atelier'}</strong>:<><button className="crumb-link" onClick={()=>goHome()}>{mode==='compact'?'Liste':'Atelier'}</button><span className="muted">/</span><span className="project-filter"><i className={project==='none'?'filter-none':`side-swatch swatch-${project}`}/><span>{project==='none'?'Sans projet':projectName(project)}</span><button aria-label="Retirer le filtre : voir tous les projets" title="Tous les projets (Échap)" onClick={()=>goHome()}><Icon d={ICONS.close.d} size={12}/></button></span></>}</>}</div>
    {current&&!settings&&<div className="header-view header-session">{status(current)}<span className="view-actions-sep"/><Button variant="ghost" size="icon" aria-pressed={showTerminal} aria-label={showTerminal?'Masquer le terminal':'Afficher le terminal'} title={`${showTerminal?'Masquer':'Afficher'} le terminal (O)`} onClick={()=>toggleTerminal()}><Icon d={terminalIcon} size={16}/></Button></div>}
    {!current&&!settings&&<div className="header-view">
     <div className="icon-tabs" role="tablist" aria-label="Vue des agents">{([['atelier','Atelier',gridIcon],['compact','Liste',listIcon]] as const).map(([v,label,d])=><button key={v} role="tab" id={`view-tab-${v}`} aria-controls={`view-panel-${v}`} aria-selected={mode===v} tabIndex={mode===v?0:-1} title={`${label}`} aria-label={label} onClick={()=>setMode(v)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=mode==='atelier'?'compact':'atelier';setMode(next);document.getElementById(`view-tab-${next}`)?.focus()}}}><Icon d={d} size={15}/></button>)}</div>
     <span className="view-actions-sep"/>
     <Button variant="ghost" size="icon" aria-pressed={helpers} aria-label={helpers?'Masquer les sous-agents':'Afficher les sous-agents'} title={helpers?'Masquer les sous-agents':'Afficher les sous-agents'} onClick={()=>setHelpers(!helpers)}><Icon d={helpers?subagentsIcon:subagentsOffIcon} size={16}/></Button>
     <Button variant="ghost" size="icon" aria-pressed={paused} aria-label={paused?'Animer':'Figer les animations'} title={paused?'Animer':'Figer les animations'} onClick={()=>setPaused(!paused)}><Icon d={paused?playIcon:pauseIcon} size={16}/></Button>
    </div>}
    <div className="header-actions">{!current&&!settings?<span className="view-actions-sep"/>:null}<Button variant="ghost" size="icon" aria-label="Rechercher une session" title="Rechercher une session (Ctrl K)" onClick={openSearch}><Icon d={searchIcon}/></Button><Button variant="ghost" size="icon" aria-label="Ouvrir le chat Ledge" title="Chat Ledge (/)" onClick={openChat}><Icon d={chatIcon}/></Button><Button variant="ghost" size="icon" aria-label="Raccourcis clavier" title="Raccourcis clavier (?)" onClick={()=>setModal('shortcuts')}><Icon d={helpIcon}/></Button><span className="view-actions-sep"/><Button variant="ghost" size="icon" aria-label={immersive?'Quitter le plein écran':'Plein écran'} title={immersive?'Quitter le plein écran':'Plein écran'} onClick={fullScreen}><Icon d={immersive?collapseIcon:ICONS.expand.d} size={16}/></Button></div></header>
    {settings?<SettingsPage section={settings} onSection={setSettings} onBack={()=>setSettings(null)} prefs={prefs} setPrefs={setPrefs} theme={theme} onTheme={setTheme} paused={paused} machines={machineList} setMachines={setMachineList} statusOf={m=>machineOffline(m)?'offline':'online'} sessionsOn={l=>agents.filter(a=>a.machine===l).length} onReconnect={l=>{setMachineList(ms=>ms.map(m=>m.label===l?{...m,reachable:true}:m));setAgents(as=>as.map(a=>a.machine===l?{...a,offline:false,reply:a.reply.startsWith('Connexion perdue')?'Connexion rétablie. Je reprends là où j’en étais.':a.reply}:a));setNotice(`${l} est reconnectée. Ses agents reprennent.`)}} projects={projects} rules={rules} setRules={setRules} agentsLite={agents} onNewProject={()=>newProject()} onEditProject={id=>editProject(id)} onDeleteProject={id=>editProject(id,true)} onReviewProposal={reviewProposal} projectAgents={id=>agents.filter(a=>a.project===id&&!a.parent).length} shortcuts={shortcutRows} notify={setNotice}/>:!current?<>
     
     {mode==='atelier'&&<div className="zoom-controls" role="toolbar" aria-label="Zoom de l’atelier"><Button variant="ghost" size="icon" aria-label="Dézoomer" title="Dézoomer (−)" onClick={()=>zoomStep(-1)}>−</Button><button className="zoom-level" title="Revenir à 100 %" onClick={()=>zoomAt(1)}>{Math.round((zoomLevel??fit)*100)} %</button><Button variant="ghost" size="icon" aria-label="Zoomer" title="Zoomer (+)" onClick={()=>zoomStep(1)}>+</Button><span className="zoom-sep"/><Button variant={zoomLevel===null?'secondary':'ghost'} size="sm" aria-pressed={zoomLevel===null} title="Tout voir (0)" onClick={fitView}><Icon d={ICONS.expand.d} size={13}/>Ajuster</Button><span className="zoom-hint">Ctrl + molette · glisser le sol · double-clic sur une table</span></div>}
     <div className={`overview-scroll ${mode} ${mode==='atelier'&&zoomLevel===null?'fitted':''}`} id={`view-panel-${mode}`} role="tabpanel" aria-labelledby={`view-tab-${mode}`}>
      {mode==='compact'?<SessionList agents={agents} projects={projects} machines={machines} inScope={inScope} helpers={helpers} focusedId={focusedId} setFocusedId={setFocusedId} open={open} decide={quickDecide} launch={launch} isolate={pid=>setProject(pid)} assign={assign} newProjectFrom={a=>newProject({prefill:{repos:[{machine:a.machine,path:a.repos,branch:null}],agents:[{id:a.id,name:a.name,tool:a.tool,checked:true}]}})} dragProps={a=>dragProps(a as Agent)} dropProps={dropProps} dragging={dragging} dropOver={dropOver} bot={(a,size)=>bot(a as Agent,size)} status={a=>status(a as Agent)} onOrder={setListOrder} emptyProject={emptyProject}/>:<div className={`office-shell ${paused?'office-paused':''}`}>
      {mode==='atelier'&&<div className="ledge-corner"><button className={`ledge-desk ${chatOpen?'active':''}`} onClick={()=>chatOpen?setChatOpen(false):openChat()} aria-label="Parler à Ledge" aria-pressed={chatOpen}>
       <span className="ledge-bubble">{chatOpen?'Je vous écoute.':`Je veille sur ${agents.filter(a=>!a.offline&&a.state!=='done').length} agents.`}<Kbd>/</Kbd></span>
       <span className="ledge-seat"><ResidentMascot size={92} theme={theme} paused={paused}/></span>
       <span className="mini-desk" aria-hidden="true"><i className="mini-sheet"/><i className="mini-sheet two"/><i className="mini-mug"/><i className="mini-lamp"/></span>
       <strong>Ledge</strong><small>Votre assistant</small>
      </button></div>}
      <div className={`project-grid ${visibleProjects.length===1?'focused':''}`}>{visibleProjects.map((p,projectIndex)=>{
       const members=agents.filter(a=>a.project===p.id);const principals=members.filter(a=>!a.parent);
       const heading=<div className="room-heading">{mode==='atelier'?<i className={`side-swatch swatch-${p.id}`}/>:<Icon d={ICONS.folder.d} size={15}/>}<span className="heading-names"><button className="project-conversations" title={p.name} aria-label={'Conversations du projet '+p.name} onClick={()=>{setProject(p.id);setMode('compact')}}>{p.name}</button><span className="heading-branch" title={p.branch}>⎇ {p.branch}</span></span>{dragging&&<span className="drop-hint">{dropOver===p.id?`Lâcher pour asseoir ${agents.find(a=>a.id===dragging)?.name}`:'Déposer ici'}</span>}<span className="spacer"/><span className="room-menu-wrap"><button className="icon-action" aria-label={`Actions du projet ${p.name}`} title="Actions du projet" aria-haspopup="menu" aria-expanded={roomMenu===p.id} onClick={()=>setRoomMenu(roomMenu===p.id?null:p.id)}><Icon d={[]} fill={['M5 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z','M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z','M19 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z']} size={14}/></button>{roomMenu===p.id&&<div className="assign-menu room-menu" role="menu" aria-label={`Actions du projet ${p.name}`}><button role="menuitem" autoFocus onClick={()=>editProject(p.id)}><span><Icon d={['M4 20h4L19 9l-4-4L4 16z','M13.5 6.5l4 4']} size={13}/>Modifier le projet</span></button><button role="menuitem" aria-label={`Nouvelle session à la table ${p.name}`} onClick={()=>{setRoomMenu(null);launch(p.id)}}><span><Icon d={ICONS.plus.d} size={13}/>Nouvelle session</span></button><button role="menuitem" aria-label={`Isoler le projet ${p.name}`} onClick={()=>{setRoomMenu(null);setProject(project===p.id?'all':p.id)}}><span><Icon d={ICONS.expand.d} size={13}/>{project===p.id?'Voir tous les projets':'Isoler cette table'}</span></button></div>}</span></div>;
       return <section className={`project-room ${dropOver===p.id?'drop-over':''}`} key={p.id} data-project={p.id} {...dropProps(p.id)} style={{'--room':`${tableLength(Math.min(principals.length,MAX_SEATS))+2*RUG_SIDE}px`} as React.CSSProperties}>{mode!=='atelier'&&heading}
        {mode==='atelier'?<div className="table-scene">
         {(()=>{const seated=principals.slice(0,MAX_SEATS);const len=tableLength(seated.length);const x=(i:number)=>seated.length===1?len/2:STEP*(i+1);const side=(i:number)=>seated.length===1||i%2===0?'t':'b';const at=(dx:number)=>`calc(50% - ${len/2}px + ${dx}px)`;
          const indexOf=(id:string)=>seated.findIndex(a=>a.id===id);
          /** Each table end seats up to END_SEATS sub-agents, stacked; a sub-agent goes to its parent's side, else the other. */
          const ends:{left:Agent[];right:Agent[]}={left:[],right:[]};for(const b of (helpers?members.filter(b=>b.parent&&indexOf(b.parent)>=0):[])){const pref=x(indexOf(b.parent!))>len/2?'right':'left';const other=pref==='left'?'right':'left';const k=ends[pref].length<END_SEATS?pref:ends[other].length<END_SEATS?other:null;if(k)ends[k].push(b)}
          const endList=(['left','right'] as const).flatMap(k=>ends[k].map((agent,slot)=>({side:k,agent,slot,count:ends[k].length})));
          return <>
         <div className="office-rug" style={{left:at(-RUG_SIDE),right:'auto',width:len+2*RUG_SIDE}}>{heading}{(()=>{const extra=Math.max(0,principals.length-MAX_SEATS)+(helpers?Math.max(0,members.filter(b=>b.parent).length-endList.length):0);return extra>0&&<button className="table-more" title="Voir tous les agents du projet dans la liste" onClick={()=>{setProject(p.id);setMode('compact')}}><span className="more-faces" aria-hidden="true">{[...principals.slice(MAX_SEATS),...members.filter(b=>b.parent&&!endList.some(e=>e.agent.id===b.id))].slice(0,3).map(a=><i key={a.id}>{bot(a,18)}</i>)}</span>+{extra} à cette table</button>})()}</div><Plants seed={p.id} left={at(-RUG_SIDE)} width={len+2*RUG_SIDE} avoid={principals.length>MAX_SEATS||(helpers&&members.filter(b=>b.parent).length>endList.length)?['br']:[]}/>{seated.map((a,i)=><div key={a.id} className={`office-chair chair-${side(i)}`} aria-hidden="true" style={{left:at(x(i)-27)}}/>)}
         <div className="worktable" aria-hidden="true" style={{left:at(0),right:'auto',width:len}}><TableTop length={len} sheets={seated.map((a,i)=>{const ns=endList.filter(e=>e.agent.parent===a.id);const n=ns[0];return {id:a.id,task:a.task,state:a.state,offline:a.offline,slot:side(i),x:x(i),note:n&&{task:n.agent.task,state:n.agent.state,offline:n.agent.offline,side:n.side,more:ns.length-1}}})}/></div>
         {seated.map((a,i)=><button key={a.id} style={{left:at(x(i)-56)}} className={`agent-seat place-${side(i)} ${seated===a.id?'just-seated':''} ${focusedId===a.id?'keyboard-selected':''} ${a.offline?'seat-offline':a.state==='working'?'seat-working':''}`} data-agent={a.id} onClick={()=>open(a.id)} aria-label={`${a.name}, ${a.task}, ${a.machine}`}>
           {bot(a,64)}<strong>{a.name}<span className="seat-shortcut">Alt {mainAgents.findIndex(b=>b.id===a.id)+1}</span></strong><span className="seat-machine">{a.machine}</span>{status(a)}
          </button>)}
         {endList.map(({side:k,agent:b,slot,count})=><button key={b.id} style={{left:k==='left'?at(-70):at(len+8),right:'auto',top:count>1?(slot?232:126):undefined}} className={`agent-seat helper-seat end-${k}`} data-agent={b.id} onClick={()=>open(b.id)} aria-label={`${b.name}, sous-agent de ${agents.find(a=>a.id===b.parent)?.name} : ${b.task}`} title={b.task}>
           {bot(b,36)}<strong>{b.name}</strong><span className="seat-meta">↳ {agents.find(a=>a.id===b.parent)?.name}</span>
          </button>)}
         </>})()}
        </div>:<div className="session-list">{principals.flatMap(a=>[a,...(helpers?members.filter(b=>b.parent===a.id):[])]).map(a=><button key={a.id} className={`session-row ${a.parent?'child':''}`} data-agent={a.id} onClick={()=>open(a.id)}>{bot(a,a.parent?26:36)}<span className="session-copy"><strong>{a.task}</strong><small>{a.name} · {a.machine}</small></span>{status(a)}</button>)}</div>}
        {mode!=='atelier'&&<div className="room-footer"><span className="muted">{p.note}</span></div>}
       </section>
      })}</div>
      {emptyProject&&<div className="empty-project"><i className={`side-swatch swatch-${emptyProject.id}`}/><h2>Aucun agent à la table {emptyProject.name}</h2><p>La table apparaîtra dès qu’une session démarre dans {emptyProject.repos}.</p><Button variant="primary" onClick={()=>launch(emptyProject.id)}><Icon d={ICONS.plus.d} size={14}/>Nouvelle session</Button></div>}
      {unassigned.length>0&&<section className={`unassigned-zone ${mode}`} aria-labelledby="unassigned-title"><div className="unassigned-heading"><Icon d={unassignedIcon} size={15}/><h2 id="unassigned-title">Sans projet</h2><span className="muted">Ledge ne relie ces sessions à aucun projet. Glissez-les vers une table, ou utilisez « Ranger dans… ».</span></div>
       <div className="unassigned-list">{unassigned.map(a=><div key={a.id} {...dragProps(a)} title="Glisser vers une table pour le ranger" className={`unassigned-card ${dragging===a.id?'is-dragged':''} ${focusedId===a.id?'keyboard-selected':''}`}><span className="drag-grip" aria-hidden="true"><i/><i/><i/><i/><i/><i/></span>
        <button className="unassigned-open" data-agent={a.id} onClick={()=>open(a.id)} aria-label={`${a.name}, ${a.task}`}>{bot(a,mode==='atelier'?56:36)}<span className="unassigned-copy"><strong>{a.name}<span className="seat-shortcut">Alt {mainAgents.findIndex(b=>b.id===a.id)+1}</span></strong><span>{a.task}</span><code>{a.machine} · {a.repos}</code></span></button>
        <div className="unassigned-actions">{status(a)}<span className="spacer"/>
        <div className="assign-wrap"><Button variant="outline" size="sm" aria-expanded={assigning===a.id} onClick={()=>setAssigning(assigning===a.id?null:a.id)}><Icon d={ICONS.folder.d} size={13}/>Ranger dans…</Button>{assigning===a.id&&<div className="assign-menu" role="menu">{projects.map(p=><button key={p.id} role="menuitem" onClick={()=>assign(a.id,p.id)}>{p.name}<small>{p.repos}</small></button>)}<button role="menuitem" className="assign-new" onClick={()=>newProject({prefill:{repos:[{machine:a.machine,path:a.repos,branch:null}],agents:[{id:a.id,name:a.name,tool:a.tool,checked:true}]}})}><span><Icon d={ICONS.plus.d} size={12}/>Nouveau projet…</span><small>À partir de {a.repos}</small></button></div>}</div></div>
       </div>)}</div></section>}
      </div>}
      {mode==='atelier'&&<div className="workspace-legend"><span><i className="live-dot"/>En cours</span><span><i className="approval-dot"/>Votre accord</span><span><i className="question-dot"/>Une question</span><span><i className="done-dot"/>Terminé ou hors ligne</span><span className="spacer"/><span>Un petit bot est un sous-agent.</span></div>}

     </div>
     <footer className="workspace-footer"><div className="footer-status"><span><i className="connection-dot"/>Sessions locales et SSH</span><button className={`overlay-state ${prefs.island?'':'off'}`} onClick={()=>openSettings('island')} title="Réglages de l’île"><i/>{prefs.island?'Île active':'Île masquée'}</button></div><div className="keyboard-footer"><button onClick={openSearch}><Kbd>Ctrl K</Kbd> Une session</button><button onClick={openChat}><Kbd>/</Kbd> Chat Ledge</button><button onClick={()=>setModal('shortcuts')}><Kbd>?</Kbd> Raccourcis</button></div></footer>
    </>:<>
     <div className={`conversation-workspace ${showTerminal?'with-terminal':''}`}>{(()=>{const team=agents.filter(a=>(a.project||'')===(current.project||''));const heads=team.filter(a=>!a.parent||!team.some(b=>b.id===a.parent));const row=(a:Agent,child=false)=><button key={a.id} className={`rail-agent ${child?'child':''} ${a.id===current.id?'current':''}`} aria-current={a.id===current.id?'page':undefined} data-agent={a.id} onClick={()=>open(a.id)}>{bot(a,child?20:26)}<span><strong>{a.name}</strong><small>{a.task}</small></span><i className={`rail-dot ${a.offline?'off':a.state}`} aria-label={a.offline?'Hors ligne':a.state}/></button>;
       return <nav className="project-rail" aria-label={`Agents du projet ${projectName(current.project)}`}><div className="rail-head"><i className={current.project?`side-swatch swatch-${current.project}`:'filter-none'}/><span>{projectName(current.project)}</span><small>{team.length}</small></div><div className="rail-list">{heads.map(a=>{const kids=team.filter(b=>b.parent===a.id);return <React.Fragment key={a.id}>{row(a)}{helpers&&kids.length>0&&<div className="rail-kids" data-parent={a.id} role="group" aria-label={`Sous-agents de ${a.name}`}><div className="rail-kids-label"><Icon d={subagentsIcon} size={11}/>Sous-agents · {kids.length}</div>{kids.map(b=>row(b,true))}</div>}</React.Fragment>})}</div><button className="rail-new" onClick={()=>launch(current.project||undefined)}><Icon d={ICONS.plus.d} size={13}/>Nouvelle session ici</button></nav>})()}<SessionPage key={current.id} agent={current} agents={agents} thread={threads[current.id]??fallbackThread(current)} update={fn=>setThreads(m=>({...m,[current.id]:fn(m[current.id]??fallbackThread(current))}))} setAgentState={(state,reply)=>{const id=current.id;setAgents(as=>as.map(a=>a.id===id?{...a,state,since:0,...(reply?{reply}:{})}:a))}} bot={(a,size)=>bot(a as Agent,size)} open={open} notify={setNotice} openMachines={()=>openSettings('machines')} keys={sessionKeys} onSeen={()=>{const id=current.id;setThreads(m=>m[id]?.unreadFrom?{...m,[id]:{...m[id],unreadFrom:undefined}}:m)}} headingExtra={(()=>{const kids=agents.filter(a=>a.parent===current.id);const parent=agents.find(a=>a.id===current.parent);const flash=(id:string)=>{const g=document.querySelector(`.rail-kids[data-parent="${id}"]`);if(!g)return;g.scrollIntoView({block:'nearest',behavior:'smooth'});g.classList.remove('rail-flash');void (g as HTMLElement).offsetWidth;g.classList.add('rail-flash')};return !parent&&kids.length?<button className="kids-pill" onClick={()=>{if(!helpers)setHelpers(true);requestAnimationFrame(()=>flash(current.id))}} title="Voir les sous-agents dans la colonne"><Icon d={subagentsIcon} size={13}/>{kids.length} sous-agent{kids.length>1?'s':''}</button>:null})()}/>
     {showTerminal&&<section className="terminal-pane"><div className="pane-heading"><Icon d={terminalIcon} size={15}/>Terminal<span className="spacer"/><span className="mono muted">{current.machine}</span></div><div className="terminal-content mono"><p className="muted">Terminal de démonstration · aucune commande exécutée</p><p><span className="terminal-prompt">❯</span> ledge attach {current.id}</p><p className="muted">{current.machine} · {current.repos}</p><div className="terminal-output">{current.offline?'Connexion SSH perdue.\nDernière sortie conservée.':needsAttention(current)?'En attente de votre réponse…':current.state==='done'?'Vérification terminée.\nRapport transmis à l’agent principal.':'Lecture du contexte de travail…\nExécution en cours…'}</div>{(logs[current.id]||[]).map((line,i)=><div className="terminal-output" key={i}>{line}</div>)}<form onSubmit={e=>{e.preventDefault();if(!command.trim())return;setLogs({...logs,[current.id]:[...(logs[current.id]||[]),'❯ '+command+'\nSimulation : commande non exécutée.']});setCommand('')}}><span className="terminal-prompt">❯</span><input aria-label="Commande de démonstration" value={command} onChange={e=>setCommand(e.target.value)} disabled={current.offline||!!current.parent} placeholder={current.offline?'Connexion indisponible':current.parent?'Sous-agent en lecture seule':'Saisir une commande…'}/></form></div><div className="terminal-footer"><span className={current.offline?'muted':'terminal-prompt'}>●</span>{current.offline?'Hors ligne':'Terminal attaché · simulation'}</div></section>}</div>
    </>}
   </section>
   {chatOpen&&<aside className="ledge-chat-panel" aria-label="Chat Ledge" onClickCapture={e=>{const a=(e.target as HTMLElement).closest('a[href^="ledge://project/"]');if(!a)return;e.preventDefault();e.stopPropagation();const pr=proposals[a.getAttribute('href')!.slice(16)];if(pr)reviewProposal(pr);else setNotice('Cette proposition n’existe plus.')}} onMouseOver={e=>{const a=(e.target as HTMLElement).closest('a[href^="ledge://session/"]');setChatHover(a?a.getAttribute('href')!.slice(16):null)}} onMouseLeave={()=>setChatHover(null)}><div className="chat-drawer-content"><ChatView visible theme={theme} turns={chatTurns} live={null} sessions={chatSessions} offline={null} onAsk={askLedge} onCancel={()=>{}} onReset={()=>setChatTurns([])} onBack={()=>setChatOpen(false)} onClose={()=>setChatOpen(false)} onOpenSession={id=>{setChatHover(null);open(id)}} launchingQid={launchingQid} onLaunchProposal={launchProposal} onTerminal={id=>open(id)} reducedMotion={paused}/></div></aside>}
  </div>
  
  {notice&&<div className="toast" role="status">{notice}</div>}
  {modal&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className={`modal ${modal==='search'?'command-palette':''} ${modal==='launch'?'composer-modal':''} ${modal==='project'?'composer-modal project-modal':''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">{modal!=='project'&&<div className="modal-title"><h2 id="modal-title">{modal==='search'?'Aller à une session':modal==='shortcuts'?'Raccourcis clavier':modal==='design'?'Le design system existant':'Nouvelle session'}</h2><Button variant="ghost" size="icon" aria-label="Fermer" onClick={()=>setModal(null)}><Icon d={ICONS.close.d}/></Button></div>}
   {modal==='search'?<><div className="palette-search"><Icon d={searchIcon}/><input autoFocus aria-label="Rechercher une session" placeholder="Agent, tâche, projet ou machine…" value={search} onChange={e=>{setSearch(e.target.value);setSearchIndex(0)}} aria-controls="session-results" aria-activedescendant={searchResults[searchIndex]?'result-'+searchResults[searchIndex].id:undefined} role="combobox" aria-expanded="true" aria-autocomplete="list"/></div><div id="session-results" role="listbox" aria-label="Sessions" className="palette-results">{searchResults.map((a,i)=><button id={'result-'+a.id} key={a.id} role="option" aria-selected={i===searchIndex} onMouseMove={()=>setSearchIndex(i)} onClick={()=>open(a.id)}>{bot(a,32)}<span><strong>{a.name} <small>· {a.project}</small></strong><small>{a.task} · {a.machine}</small></span>{status(a)}{!a.parent&&mainAgents.indexOf(a)<9&&<Kbd>Alt {mainAgents.indexOf(a)+1}</Kbd>}</button>)}{!searchResults.length&&<p className="empty-attention">Aucune session ne correspond à cette recherche.</p>}</div><div className="palette-footer"><Kbd>↑ ↓</Kbd> Parcourir <Kbd>Entrée</Kbd> Ouvrir <Kbd>Échap</Kbd> Fermer</div></>:modal==='shortcuts'?<div className="shortcut-list"><p>Actifs dans cette maquette lorsque la fenêtre a le focus. Les touches de navigation restent disponibles pour la saisie et le terminal lorsqu’ils ont le focus.</p>{shortcutRows.map(([keys,action])=><div key={keys}><span>{action}</span><Kbd>{keys}</Kbd></div>)}<p>Ctrl / ⌘ K ouvre la recherche depuis n’importe quelle vue. Y et N n’agissent que sur la demande épinglée de la session ouverte, jamais pendant la saisie.</p></div>:
   modal==='design'?<div className="design-notes"><p>Cette maquette importe directement les composants de l’overlay.</p><dl><dt>Couleurs et rayons</dt><dd className="mono">styles/tokens.css</dd><dt>Mascottes</dt><dd>Bot et ResidentMascot · Signal en sombre, Galet en clair.</dd><dt>Contrôles</dt><dd>Button, Badge, Tabs et Icon.</dd><dt>Typographie</dt><dd>Geist et Geist Mono, avec les mêmes polices système de repli.</dd><dt>États</dt><dd>Bleu : en cours. Rouge : autorisation. Ambre : question. Vert : disponible.</dd></dl><p className="muted">Les tables, la navigation desktop et la disposition sont les éléments proposés. Les données et interactions sont simulées.</p></div>:modal==='project'&&editor?<ProjectEditor key={JSON.stringify(editor.initial).length+editor.mode+(editor.startDelete?'d':'')} {...editor} projects={projects} agents={agents} machines={machines} theme={theme} paused={paused} rulesFor={id=>rules.filter(r=>r.project===id).length} onSave={saveProject} onDelete={deleteProject} onCancel={()=>{setModal(null);setEditor(null)}}/>:<LaunchComposer projects={projects} machines={machines} takenNames={agents.map(a=>a.name)} initialProject={launchProject} seats={pid=>agents.filter(a=>a.project===pid&&!a.parent).length} theme={theme} paused={paused} onLaunch={r=>{startAgent(r)}} onCancel={()=>setModal(null)}/>}
  </section></div>}
 </div></LangProvider>
}
createRoot(document.getElementById('root')!).render(<App/>);
