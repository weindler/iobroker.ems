import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { it } from 'node:test';

function display(states={}) {
  const html=readFileSync(new URL('./ems-charts.html',import.meta.url),'utf8');
  let script=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
  script=script.replace('if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();',
    'window.qa={cache:cache,renderBatteryPage:renderBatteryPage,renderClimatePage:renderClimatePage,renderThermalPage:renderThermalPage,renderWallboxPage:renderWallboxPage,renderStatistics:renderStatistics,renderHorizon:renderHorizon};');
  const elements=new Map();
  const element=()=>({innerHTML:'',value:'',options:[],style:{},classList:{add(){},remove(){},toggle(){}},
    querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){},getAttribute(){return null;},setAttribute(){}});
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
    querySelectorAll(){return [];},addEventListener(){},createElement:element};
  const window={location:{search:''},addEventListener(){}};
  vm.runInNewContext(script,{window,document,URLSearchParams,console,Date,setTimeout(){},setInterval(){},clearTimeout(){},clearInterval(){}});
  for(const [key,value] of Object.entries(states))window.qa.cache['ems.0.'+key]=typeof value==='object'?JSON.stringify(value):value;
  return {qa:window.qa,elements};
}

it('renders every detail page without live adapter or missing-data exceptions',()=>{
  const {qa,elements}=display();
  for(const key of Object.keys(qa))if(key.startsWith('render'))qa[key]();
  assert.match(elements.get('ems-battery-page').innerHTML,/Noch keine belastbare Prognose/);
});
it('winter mode overrides speculative climate and heater plans',()=>{
  const {qa,elements}=display({'global.winter_operation_active':true,'addons.air_conditioning.mode':'live','addons.immersion_heater.mode':'live'});
  qa.renderClimatePage();qa.renderThermalPage();
  assert.match(elements.get('ems-climate-page').innerHTML,/Heizsaison gestartet/);
  assert.doesNotMatch(elements.get('ems-climate-page').innerHTML,/keine Kühlung erforderlich/);
  assert.match(elements.get('ems-thermal-page').innerHTML,/externe Heizquelle/);
});
it('external vehicle control never advertises a competing EMS window',()=>{
  const {qa,elements}=display({'addons.wallbox.mode':'live','addons.wallbox.status.ev_foundation.external_authority_state':'active_without_plan','addons.wallbox.status.evcc.charging':false});
  qa.renderWallboxPage();
  assert.match(elements.get('ems-wallbox-page').innerHTML,/keinen konkurrierenden Ladeplan/);
  assert.match(elements.get('ems-wallbox-page').innerHTML,/Aktuell keine aktive Ladung/);
});
