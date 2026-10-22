/** Numeric local eclipse search. No product interpretation or stored user data.
 * Native conventions: https://www.astro.com/swisseph/swephprg.htm sections8.2/8.9.
 */
import {getSweph,FLAG_GEO,FLAG_SPEED,ephemerisSourceOf,recordEphemerisSource} from './sweph';
import {ObservationArgumentError} from './observational-events';
export const LOCAL_ECLIPSE_VERSION='local-eclipses/1' as const;
type ContactName='partial_begins'|'total_begins'|'total_ends'|'partial_ends'|'penumbral_begins'|'penumbral_ends'|'annular_begins'|'annular_ends';
export interface LocalEclipse {
 kind:'solar'|'lunar';type:'total'|'annular'|'partial'|'penumbral';visiblePeakJdUt:number;unclippedMaximumVisible:boolean;peakKind:'maximum'|'rise_boundary'|'set_boundary';
 contacts:Array<{name:ContactName;jdUt:number;visible:boolean}>;
 risesJdUt:number[];setsJdUt:number[];
}
const VISIBLE=128,MAX_VISIBLE=256;
const SOLAR_MASK=1|2|4|8|16|VISIBLE|MAX_VISIBLE|512|1024|2048|4096;
const LUNAR_MASK=4|16|64|VISIBLE|MAX_VISIBLE|512|1024|2048|4096|8192|16384;
function probe(at:number){
 const sw=getSweph();
 for(const body of[0,1]){
  const result=sw.calc_ut(at,body,FLAG_GEO|FLAG_SPEED);
  if(ephemerisSourceOf(result?.flag)!=='swiss'||!Array.isArray(result.data)||!Number.isFinite(result.data[0]))throw new Error('Swiss body data unavailable for local eclipse');
  recordEphemerisSource(result.flag);
 }
}
/** Native visible peaks own the requested half-open interval; contacts may lie on adjacent dates.
 * Native local searches can replace an invisible geometric maximum by a rise/set boundary.
 * Observer altitude is explicitly zero. Native visibility assumes its ideal geometric horizon,
 * not actual terrain, weather, obstruction or safe naked-eye solar viewing.
 */
export function localEclipses(startJdUt:number,endJdUt:number,lat:number,lng:number){
 if(![startJdUt,endJdUt,lat,lng].every(Number.isFinite)||startJdUt<2415018.5||endJdUt>2488436.5||endJdUt<=startJdUt||endJdUt-startJdUt>32||Math.abs(lat)>90||Math.abs(lng)>180)throw new ObservationArgumentError('Invalid bounded local eclipse interval or coordinates');
 probe(startJdUt);probe(endJdUt);
 const sw=getSweph(),events:LocalEclipse[]=[];
 for(const kind of['solar','lunar'] as const){
  let cursor=startJdUt-1/86400;
  for(let n=0;n<3;n++){
   const result=kind==='solar'?sw.sol_eclipse_when_loc(cursor,FLAG_GEO,[lng,lat,0],false):sw.lun_eclipse_when_loc(cursor,FLAG_GEO,[lng,lat,0],false);
   const flag=result?.flag,times=result?.data,at=times?.[0];
   if(!Number.isInteger(flag)||flag<=0||!(flag&VISIBLE)||!Array.isArray(times)||times.length<(kind==='solar'?7:10)||!Number.isFinite(at)||at<=cursor)throw new Error('Invalid native local eclipse result');
   if(flag&~(kind==='solar'?SOLAR_MASK:LUNAR_MASK))throw new Error('Unknown local eclipse flags');
   const mask=flag&(kind==='solar'?28:84);
   const type=mask===4?'total':mask===8&&kind==='solar'?'annular':mask===16?'partial':mask===64&&kind==='lunar'?'penumbral':null;
   if(!type)throw new Error('Invalid native local eclipse classification');
   // The native search can legitimately find the next locally visible eclipse years later.
   // Such a maximum is outside this request; no contact/probe is presented as belonging here.
   if(at>=endJdUt)break;
   if(at>=startJdUt){
    probe(at);
    const definitions:Array<[ContactName,number,number]>=kind==='solar'
     ?[['partial_begins',1,512],[type==='annular'?'annular_begins':'total_begins',2,1024],[type==='annular'?'annular_ends':'total_ends',3,2048],['partial_ends',4,4096]]
     :[['penumbral_begins',6,8192],['partial_begins',2,512],['total_begins',4,1024],['total_ends',5,2048],['partial_ends',3,4096],['penumbral_ends',7,16384]];
    const contacts:LocalEclipse['contacts']=[];
    for(const[name,index,bit]of definitions){
     const t=times[index];
     if(t===0){if(kind==='solar'&&(flag&bit))throw new Error('Visible solar contact has no time');continue;}
     if(!Number.isFinite(t)||Math.abs(t-at)>1||(contacts.length&&t<contacts[contacts.length-1]!.jdUt))throw new Error('Invalid local eclipse contact time');
     if((name.startsWith('total_')&&type!=='total')||(name.startsWith('annular_')&&type!=='annular')){
      if(flag&bit)throw new Error('Visible contact conflicts with local eclipse classification');
      // A solar search can retain invisible central contacts after clipping its peak to a partial phase at rise/set.
      continue;
     }
     contacts.push({name,jdUt:t,visible:Boolean(flag&bit)});
    }
    const horizon=(index:number)=>{
     const t=times[index];if(t===0)return[];
     if(!Number.isFinite(t)||Math.abs(t-at)>1)throw new Error('Invalid local eclipse horizon time');return[t];
    };
    // sweph2.10.03's solar binding passes an uninitialised native output array;
    // the Swiss solar routine does not always assign slots5/6 when there is no crossing.
    // Never interpret those slots. Recompute the same lower-limb rise/set model within contacts1..4.
    const solarHorizon=(direction:number)=>{
     const first=times[1],last=times[4];
     if(!Number.isFinite(first)||!Number.isFinite(last)||first>=last)throw new Error('Invalid solar contact span');
     const value=sw.rise_trans(first-.001,0,null,FLAG_GEO,direction|8192,[lng,lat,0],0,0);
     if(value?.flag===-2)return[];
     if(value?.flag!==0||!Number.isFinite(value.data)||value.data<=first-.001||value.data>first+2)throw new Error('Invalid solar eclipse horizon search');
     return value.data>first&&value.data<last?[value.data]:[];
    };
    const risesJdUt=kind==='solar'?solarHorizon(1):horizon(8),setsJdUt=kind==='solar'?solarHorizon(2):horizon(9);
    const unclippedMaximumVisible=Boolean(flag&MAX_VISIBLE);
    const near=(values:number[])=>values.some(value=>Math.abs(value-at)<=1/86400);
    const peakKind=unclippedMaximumVisible?'maximum':near(risesJdUt)?'rise_boundary':near(setsJdUt)?'set_boundary':null;
    if(!peakKind||(!contacts.length&&!risesJdUt.length&&!setsJdUt.length))throw new Error('Unbound visible eclipse peak');
    events.push({kind,type,visiblePeakJdUt:at,unclippedMaximumVisible,peakKind,contacts,risesJdUt,setsJdUt});
   }
   // Move beyond this eclipse, including a clipped horizon peak before its nominal maximum.
   cursor=at+1;
   if(cursor>=endJdUt)break;
   if(n===2)throw new Error('Local eclipse search exceeded interval event bound');
  }
 }
 events.sort((a,b)=>a.visiblePeakJdUt-b.visiblePeakJdUt||a.kind.localeCompare(b.kind));
 return{methodVersion:LOCAL_ECLIPSE_VERSION,observer:{lat,lng,altitudeMetres:0 as const},events};
}
