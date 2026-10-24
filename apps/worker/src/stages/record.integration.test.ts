import { createServer } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { FlowsFile, JobConfig, Timeline, jobPaths } from '@agentcast/shared';
import { readArtifact, writeArtifact } from '@agentcast/shared/node';
import { candidateSpans } from '@agentcast/story';
import type { StageContext } from '../context';
import { record } from './record';

it.skipIf(process.env.AGENTCAST_BROWSER_TESTS!=='1')('records approved flow IDs and actual actions instead of unrelated fixture footage',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'agentcast-record-handoff-'));
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Recording integration</h1><button onclick="document.querySelector(\'p\').textContent=\'Project created\'">Create project</button><p>Ready</p>');});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
  const previous=process.env.AGENTCAST_STAGE_MODE;process.env.AGENTCAST_STAGE_MODE='real';
  const ctx={jobId:'test-real-record',dir,config:JobConfig.parse({url}),signal:AbortSignal.timeout(60000),
    path:(file:string)=>join(dir,file),read:(file:string,schema:Parameters<typeof readArtifact>[1])=>readArtifact(join(dir,file),schema),
    write:(file:string,schema:Parameters<typeof writeArtifact>[1],data:unknown)=>writeArtifact(join(dir,file),schema,data),
    log:vi.fn(),progress:vi.fn(),artifact:vi.fn(),
  } as unknown as StageContext;
  try {
    const flows=FlowsFile.parse({schemaVersion:1,flows:[0,1].map(index=>({id:`real-flow-${index}`,title:`Real flow ${index}`,whyItMatters:'Show a changed product page',startUrl:url,requiresAuth:false,rank:index,selected:true,source:'user',steps:[{id:'create',action:'click',target:{role:'button',text:'Create project'},expect:[{type:'text',text:'Project created',match:'exact'}]}]}))});
    await ctx.write(jobPaths.flows,FlowsFile,flows);
    await record(ctx);
    const timeline=await ctx.read(jobPaths.timeline('desktop'),Timeline);
    expect(timeline.flows.map(flow=>flow.flowId)).toEqual(['real-flow-0','real-flow-1']);
    expect(timeline.flows[1]!.in).toBe(timeline.flows[0]!.out);
    expect(timeline.flows[1]!.out).toBe(timeline.duration);
    for(const flow of flows.flows) {
      expect(timeline.events.some(event=>event.flowId===flow.id&&event.kind==='click')).toBe(true);
      expect(timeline.events.some(event=>event.flowId===flow.id&&event.kind==='settled')).toBe(true);
    }
    expect(candidateSpans(flows.flows.map(flow=>({flowId:flow.id,title:flow.title,timeline})))).toHaveLength(2);
    expect((await stat(ctx.path(jobPaths.recording('desktop')))).size).toBeGreaterThan(1000);
  } finally {
    if(previous===undefined) delete process.env.AGENTCAST_STAGE_MODE; else process.env.AGENTCAST_STAGE_MODE=previous;
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(dir,{recursive:true,force:true});
  }
},65000);
