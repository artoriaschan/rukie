import { spawn } from "node:child_process";
import { once } from "node:events";
import type { WireCommand } from "@rukie/shared";

/** Real WS transport; scripted wire replies replace the server boundary, never a model. */
export async function startWireFixture() {
  const script = `
const commands = [], sockets = new Set(), responses=[];let hold=false,nextError=null,folder=null;let providers=[], keys={};
let sessions = [{id:"one",title:"Fix compiler",titleSource:"prompt",updatedAt:20,createdAt:10,messageCount:1,model:"test/script",cwd:"/project",projectId:"project",worktree:null},{id:"two",title:"Explore ideas",titleSource:"prompt",updatedAt:10,createdAt:20,messageCount:1,model:"test/script",cwd:"/workspace",projectId:null,worktree:null}];
let projects = [{id:"project",name:"Project",directories:["/project"],primary:"/project",trusted:true}];
const models = [{spec:"test/script",id:"script",name:"Script model",providerId:"test",providerName:"Test",input:["text","image"],reasoning:true,thinkingLevels:["off","low","high"],contextWindow:10000,custom:true,authenticated:true}];
let worktrees=[];
let git={repository:true,branch:"main",head:"0123456789012345678901234567890123456789",branches:["dev/2026-0521","main","release/very-long-branch-name-for-truncation"]};
let mode="ask", thinking="off", busy=false, preferences={}, pinned=["one"], archived=[];
const sessionState = id=>({type:"session_state",sessionId:id,permissionMode:mode,thinkingLevel:thinking,contextReport:{model:"test/script",window:10000,used:2500,categories:[{name:"system-prompt",tokens:500},{name:"system-tools",tokens:1000},{name:"messages",tokens:1000}],memoryFiles:[],mcpTools:[],skills:[],agentTypes:[]}});
let homeDir="/fixture-home";

const changed = () => ({type:"sessions_changed",homeDir,sessions,projects,pinned,archived,preferences});
const snapshot = id => ({type:"snapshot",sessionId:id,messages:[],entries:[],tools:[],compactions:[],inbox:[],queuedInputs:[],agent:{},usage:{},background:[],toolStates:{},runSummaries:[],model:"test/script",planMode:false,permissionMode:"ask"});
const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req,server)=>{
const url=new URL(req.url);
if(url.pathname==="/ws") {server.upgrade(req);return;}
if(req.method==="OPTIONS")return new Response(null,{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type"}});
let value={};
if(url.pathname==="/commands")value=commands;
if(url.pathname==="/hold")hold=true;
if(url.pathname==="/flush"){hold=false;for(const response of responses.reverse())response.ws.send(JSON.stringify(response.message));responses.length=0;}
if(url.pathname==="/message"){const message=await req.json();if(message.type==="sessions_changed"){homeDir=message.homeDir;projects=message.projects;sessions=message.sessions;pinned=message.pinned;archived=message.archived;preferences=message.preferences;}for(const ws of sockets)ws.send(JSON.stringify(message));}
if(url.pathname==="/disconnect")for(const ws of sockets)ws.close(1000,"network");
if(url.pathname==="/busy")busy=true;
if(url.pathname==="/error")nextError=await req.json();
if(url.pathname==="/worktrees")worktrees=await req.json();
if(url.pathname==="/git")git=await req.json();
if(url.pathname==="/folder")folder=await req.json();
if(url.pathname==="/supersede")for(const ws of sockets)ws.close(4000,"superseded");
return Response.json(value,{headers:{"Access-Control-Allow-Origin":"*"}});
},websocket:{open(ws){sockets.add(ws);ws.send(JSON.stringify(changed()));},close(ws){sockets.delete(ws)},message(ws,text){const c=JSON.parse(text);commands.push(c);let result={};if(c.type==="modelServices.list")result=providers;if(c.type==="modelServices.save"){const i=c.provider.id;if(c.credential.type==="replace")keys[i]=c.credential.value;if(c.credential.type==="delete")delete keys[i];providers=providers.filter(p=>p.id!==i);providers.push({...c.provider,hasCredential:!!keys[i]});}if(c.type==="modelServices.delete"){providers=providers.filter(p=>p.id!==c.providerId);delete keys[c.providerId];}if(c.type==="modelServices.revealKey")result={value:keys[c.providerId]??null};if(c.type==="modelServices.prices")result={status:"unavailable"};if(c.type==="host.pickFolder")result=folder;if(c.type==="tool_output.read")result={stdout:"historical full output",stderr:"",nextOffset:22,dropped:false};if(c.type==="worktrees.list" || c.type==="worktrees.refresh")result=worktrees;if(c.type==="worktree.delete" && nextError?.type!==c.type){worktrees=worktrees.filter(t=>t.id!==c.worktreeId);result=worktrees;}if(c.type==="project.git")result=git;if((c.type==="project.checkout"||c.type==="project.createBranch") && nextError?.type!==c.type){git={...git,branch:c.branch,branches:c.type==="project.createBranch"?[...git.branches,c.branch].sort():git.branches};result=git;}if(c.type==="projects.list")result=projects;if(c.type==="sessions.list")result=sessions;if(c.type==="models.list")result=models;if(c.type==="session.subscribe"){ws.send(JSON.stringify(snapshot(c.sessionId)));ws.send(JSON.stringify(sessionState(c.sessionId)));if(busy){ws.send(JSON.stringify({type:"response",id:c.id,error:{code:"session_busy"}}));return;}}if(c.type==="session.create" && nextError?.type!==c.type){result={sessionId:"new",requestId:"request-new"};sessions.push({...sessions[0],id:"new",title:c.text,projectId:c.project??null,cwd:c.project?projects.find(p=>p.id===c.project)?.primary:"/workspace"});ws.send(JSON.stringify(snapshot("new")));ws.send(JSON.stringify(changed()));}if(c.type==="preferences.set"){preferences=c.preferences;ws.send(JSON.stringify(changed()));}if(c.type==="session.rename" && nextError?.type!==c.type){const session=sessions.find(s=>s.id===c.sessionId);if(session){session.title=c.title;session.titleSource="user";ws.send(JSON.stringify(changed()));}}if(c.type==="session.move" && nextError?.type!==c.type){const session=sessions.find(s=>s.id===c.sessionId),project=projects.find(p=>p.id===c.projectId);session.cwd=project?.primary??"/workspace/moved";session.projectId=project?.id??null;ws.send(JSON.stringify(changed()));}if(c.type==="session.pin"){pinned=[...new Set([...pinned,c.sessionId])];ws.send(JSON.stringify(changed()));}if(c.type==="session.delete" && nextError?.type!==c.type){sessions=sessions.filter(s=>s.id!==c.sessionId);pinned=pinned.filter(id=>id!==c.sessionId);archived=archived.filter(id=>id!==c.sessionId);ws.send(JSON.stringify({...changed(),closedSessionId:c.sessionId}));}if(c.type==="session.archive"){pinned=pinned.filter(id=>id!==c.sessionId);archived=[...new Set([...archived,c.sessionId])];ws.send(JSON.stringify({...changed(),closedSessionId:c.sessionId}));}if(c.type==="session.unpin"){pinned=pinned.filter(id=>id!==c.sessionId);ws.send(JSON.stringify(changed()));}if(c.type==="withdraw")result={input:{requestId:c.requestId,prompt:"Withdrawn draft",images:[]}};if(c.type==="abort")result={inputs:[{requestId:"queued",prompt:"Queued draft",images:[{data:"abcd",mimeType:"image/png",name:"queued.png"}]}]};if(c.type==="session.set_permission_mode"){mode=c.mode;ws.send(JSON.stringify(sessionState(c.sessionId)));}if(c.type==="session.set_model"){thinking=c.thinkingLevel??"off";ws.send(JSON.stringify(sessionState(c.sessionId)));}if(c.type==="project.create" && nextError?.type!==c.type){result=projects.find(p=>p.primary===c.directories[0])??{id:"added",name:c.name.trim(),directories:c.directories,primary:c.directories[0],trusted:true};if(!projects.some(p=>p.id===result.id))projects.push(result);ws.send(JSON.stringify(changed()));}if(c.type==="project.update" && nextError?.type!==c.type){result=projects.find(p=>p.id===c.projectId);Object.assign(result,{name:c.name.trim(),directories:c.directories,primary:c.primary});ws.send(JSON.stringify(changed()));}if(c.type==="project.remove" && nextError?.type!==c.type){const deleted=sessions.filter(s=>s.projectId===c.projectId).map(s=>s.id);sessions=sessions.filter(s=>!deleted.includes(s.id));pinned=pinned.filter(id=>!deleted.includes(id));archived=archived.filter(id=>!deleted.includes(id));projects=projects.filter(p=>p.id!==c.projectId);for(const id of deleted)ws.send(JSON.stringify({...changed(),closedSessionId:id}));ws.send(JSON.stringify(changed()));}if(c.type==="project.trust" && nextError?.type!==c.type){result=projects.find(p=>p.id===c.projectId);result.trusted=true;ws.send(JSON.stringify(changed()));}if(nextError?.type===c.type){ws.send(JSON.stringify({type:"response",id:c.id,error:{code:nextError.code,params:nextError.params}}));nextError=null;return;}if(hold)responses.push({ws,message:{type:"response",id:c.id,result}});else ws.send(JSON.stringify({type:"response",id:c.id,result}));}}});
console.log(JSON.stringify({port:server.port,token:"scripted"}));
`;
  const child = spawn("bun", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(child, "exit");
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      child.kill();
      await exit;
    })());
  let connection: { port: number; token: string };
  try {
    connection = await new Promise<{ port: number; token: string }>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Wire fixture handshake timed out")),
        5000,
      );
      const fail = (error: unknown) => {
        clearTimeout(deadline);
        reject(error);
      };
      child.once("error", fail);
      let output = "";
      child.stdout.on("data", (data: Buffer) => {
        output += data.toString();
        if (output.includes("\n")) {
          try {
            const parsed: unknown = JSON.parse(output);
            if (
              !parsed ||
              typeof parsed !== "object" ||
              !("port" in parsed) ||
              !("token" in parsed) ||
              typeof parsed.port !== "number" ||
              typeof parsed.token !== "string"
            )
              throw new Error("Invalid wire fixture handshake");
            clearTimeout(deadline);
            resolve({ port: parsed.port, token: parsed.token });
          } catch (error) {
            fail(error);
          }
        }
      });
      child.once("exit", () => fail(new Error("Wire fixture exited before handshake")));
    });
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Wire acquisition failed");
    }
    throw error;
  }
  const url = `http://127.0.0.1:${connection.port}`;
  return {
    connection,
    commands: async (): Promise<WireCommand[]> => (await fetch(`${url}/commands`)).json(),
    send: async (message: unknown) => {
      await fetch(`${url}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
    },
    disconnect: async () => {
      await fetch(`${url}/disconnect`);
    },
    close,
  };
}
