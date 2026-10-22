import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({source:2,solar:[] as any[],lunar:[] as any[],calls:[] as any[],rise:{flag:-2,data:0},set:{flag:-2,data:0}}));
const start=2451545,end=start+1;
vi.mock('./sweph',async(importOriginal)=>({...await importOriginal<typeof import('./sweph')>(),FLAG_GEO:2,FLAG_SPEED:256,swephLibraryVersion:()=> '2.10.03',withSourceRecording:(fn:any)=>({result:fn(),sources:['swiss']}),ephemerisSourceOf:(f:number)=>f===2?'swiss':'moshier',recordEphemerisSource:vi.fn(),getSweph:()=>({
 calc_ut:()=>({flag:h.source,data:[100]}),
 rise_trans:(...a:any[])=>a[4]===(8192|1)?h.rise:h.set,
 sol_eclipse_when_loc:(...a:any[])=>{h.calls.push(['solar',...a]);return h.solar.shift()??{flag:16|128,data:[2451745,2451744.9,0,0,2451745.1,0,0]}},
 lun_eclipse_when_loc:(...a:any[])=>{h.calls.push(['lunar',...a]);return h.lunar.shift()??{flag:64|128,data:[2451745,0,0,0,0,0,2451744.9,2451745.1,0,0]}},
})}));
import {localEclipses,LOCAL_ECLIPSE_VERSION} from './local-eclipses';
import {dispatch,engineIdentity,RpcArgumentError} from './rpc';
const solar=()=>({flag:4|128|256|512|1024|2048|4096,data:[start+.5,start+.4,start+.49,start+.51,start+.6,0,0]});
const lunar=()=>({flag:4|128|256|512|1024|2048|4096|8192|16384,data:[start+.5,0,start+.4,start+.6,start+.45,start+.55,start+.3,start+.7,0,0]});
beforeEach(()=>{h.source=2;h.solar=[];h.lunar=[];h.calls=[];h.rise={flag:-2,data:0};h.set={flag:-2,data:0};});
it('binds the exact observer and preserves local maximum/contact visibility separately',()=>{
 const s=solar();s.flag&=~256;s.flag&=~512;s.data[0]=start+.42;s.data[5]=start+.42;h.solar=[s];h.rise={flag:0,data:start+.42};
 const r=localEclipses(start,end,51.5,-.1);
 expect(r).toMatchObject({methodVersion:LOCAL_ECLIPSE_VERSION,observer:{lat:51.5,lng:-.1,altitudeMetres:0},events:[{kind:'solar',type:'total',unclippedMaximumVisible:false,peakKind:'rise_boundary',risesJdUt:[start+.42]}]});
 expect(r.events[0]!.contacts[0]!.visible).toBe(false);expect(r.events[0]!.contacts[1]!.visible).toBe(true);
 expect(h.calls[0].slice(2)).toEqual([2,[-.1,51.5,0],false]);
});
it('maps lunar contact indexes to chronological phases rather than solar indexes',()=>{h.lunar=[lunar()];expect(localEclipses(start,end,0,0).events[0]!.contacts.map(c=>c.name)).toEqual(['penumbral_begins','partial_begins','total_begins','total_ends','partial_ends','penumbral_ends'])});
it('keeps an annular local phase distinct from totality',()=>{const s=solar();s.flag=(s.flag&~4)|8;h.solar=[s];expect(localEclipses(start,end,0,0).events[0]!.contacts[1]!.name).toBe('annular_begins')});
it('permits a future local eclipse outside the selected interval without inventing an event',()=>{expect(localEclipses(start,end,0,0).events).toEqual([])});
it('includes exact start and excludes exact end maxima',()=>{const a=solar(),b=solar();a.data=a.data.map(t=>t?t-.5:0);b.data=b.data.map(t=>t?t+.5:0);h.solar=[a,b];expect(localEclipses(start,end,0,0).events).toHaveLength(1)});
it.each([0,-1,4,4|128|32768,12|128])('rejects absent visibility or unrecognized/classification flags%s',flag=>{h.solar=[{...solar(),flag}];expect(()=>localEclipses(start,end,0,0)).toThrow()});
it.each([NaN,start-1,start-1/86400])('refuses invalid or nonprogressing maxima%s',at=>{const s=solar();s.data[0]=at;h.solar=[s];expect(()=>localEclipses(start,end,0,0)).toThrow()});
it.each([NaN,start-2,start+.55])('refuses missing, distant or unordered contact times%s',t=>{const s=solar();s.data[2]=t;h.solar=[s];expect(()=>localEclipses(start,end,0,0)).toThrow()});
it('does not turn a visible contact without a time into midnight',()=>{const s=solar();s.data[2]=0;h.solar=[s];expect(()=>localEclipses(start,end,0,0)).toThrow()});
it('does not infer a totality contact from a locally partial eclipse',()=>{const s=solar();s.flag=(s.flag&~4)|16;h.solar=[s];expect(()=>localEclipses(start,end,0,0)).toThrow()});
it('refuses invalid reconstructed solar horizon results',()=>{h.solar=[solar()];h.rise={flag:0,data:NaN};expect(()=>localEclipses(start,end,0,0)).toThrow()});
it('does not interpret uninitialised native solar horizon slots as observed crossings',()=>{const s=solar();s.data[5]=NaN;s.data[6]=start+.55;h.solar=[s];expect(localEclipses(start,end,0,0).events[0]).toMatchObject({risesJdUt:[],setsJdUt:[]})});
it('omits a legitimate next-day solar rise outside the eclipse contact span',()=>{h.solar=[solar()];h.rise={flag:0,data:start+1.2};expect(localEclipses(start,end,0,0).events[0]!.risesJdUt).toEqual([])});
it('requires explicit Swiss body provenance before using native eclipse flags',()=>{h.source=4;expect(()=>localEclipses(start,end,0,0)).toThrow('Swiss');expect(h.calls).toEqual([])});
it.each([[start,start+33,0,0],[start,start,0,0],[0,1,0,0],[start,end,91,0],[start,end,0,181],[start,end,NaN,0]])('bounds the requested interval and observer%j',(...v)=>{expect(()=>localEclipses(v[0]!,v[1]!,v[2]!,v[3]!)).toThrow()});
it('rejects impossible repeated searches instead of looping indefinitely',()=>{const s=solar();h.solar=[s,s];expect(()=>localEclipses(start,start+5,0,0)).toThrow()});

it('refuses a truncated native solar tuple',()=>{const s=solar();s.data.pop();h.solar=[s];expect(()=>localEclipses(start,end,0,0)).toThrow()});
it('advertises the separate capability and binds the RPC result metadata',()=>{expect(engineIdentity().localEclipseVersion).toBe(LOCAL_ECLIPSE_VERSION);expect(()=>dispatch('localEclipses',{startJdUt:start,endJdUt:end,lat:0,lng:0})).toThrow(RpcArgumentError);const result=dispatch('localEclipses',{startJdUt:start,endJdUt:end,lat:0,lng:0,methodVersion:LOCAL_ECLIPSE_VERSION});expect(result.meta.methodVersion).toBe(LOCAL_ECLIPSE_VERSION)});
it.each([{lat:91},{lng:181},{endJdUt:start+33},{methodVersion:'observational-events/1'}])('RPC refuses invalid local eclipse request%j',patch=>{expect(()=>dispatch('localEclipses',{startJdUt:start,endJdUt:end,lat:0,lng:0,methodVersion:LOCAL_ECLIPSE_VERSION,...patch})).toThrow(RpcArgumentError)});
