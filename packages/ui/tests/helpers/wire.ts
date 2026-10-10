import { spawn } from "node:child_process";
import { once } from "node:events";
import type { WireCommand } from "@rukie/shared";

/** Real WS transport; scripted wire replies replace the server boundary, never a model. */
export async function startWireFixture() {
  const script = `
const commands = [], sockets = new Set(), responses=[];let hold=false;
const sessions = [{id:"one",title:"Fix compiler",titleSource:"prompt",updatedAt:20,createdAt:10,messageCount:1,model:"test/script",cwd:"/project"},{id:"two",title:"Explore ideas",titleSource:"prompt",updatedAt:10,createdAt:20,messageCount:1,model:"test/script",cwd:"/workspace"}];
const projects = [{id:"project",name:"Project",path:"/project"}];
const models = [{spec:"test/script",id:"script",name:"Script model",providerId:"test",providerName:"Test",input:["text","image"],reasoning:true,thinkingLevels:["off","low","high"],contextWindow:10000,custom:true,authenticated:true}];
let mode="ask", thinking="off", busy=false, preferences={}, pinned=["one"];
const sessionState = id=>({type:"session_state",sessionId:id,permissionMode:mode,thinkingLevel:thinking,contextReport:{model:"test/script",window:10000,used:2500,categories:[{name:"system-prompt",tokens:500},{name:"system-tools",tokens:1000},{name:"messages",tokens:1000}],memoryFiles:[],mcpTools:[],skills:[],agentTypes:[]}});
const changed = () => ({type:"sessions_changed",sessions,projects,pinned,preferences});
const snapshot = id => ({type:"snapshot",sessionId:id,messages:[],entries:[],tools:[],compactions:[],inbox:[],queuedInputs:[],agent:{},usage:{},background:[],toolStates:{},runSummaries:[],model:"test/script",planMode:false,permissionMode:"ask"});
const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req,server)=>{
const url=new URL(req.url);
if(url.pathname==="/ws") {server.upgrade(req);return;}
if(req.method==="OPTIONS")return new Response(null,{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type"}});
let value={};
if(url.pathname==="/commands")value=commands;
if(url.pathname==="/hold")hold=true;
if(url.pathname==="/flush"){hold=false;for(const response of responses.reverse())response.ws.send(JSON.stringify(response.message));responses.length=0;}
if(url.pathname==="/message"){const message=await req.json();for(const ws of sockets)ws.send(JSON.stringify(message));}
if(url.pathname==="/disconnect")for(const ws of sockets)ws.close(1000,"network");
if(url.pathname==="/busy")busy=true;
if(url.pathname==="/supersede")for(const ws of sockets)ws.close(4000,"superseded");
return Response.json(value,{headers:{"Access-Control-Allow-Origin":"*"}});
},websocket:{open(ws){sockets.add(ws);ws.send(JSON.stringify(changed()));},close(ws){sockets.delete(ws)},message(ws,text){const c=JSON.parse(text);commands.push(c);let result={};if(c.type==="projects.list")result=projects;if(c.type==="sessions.list")result=sessions;if(c.type==="models.list")result=models;if(c.type==="session.subscribe"){ws.send(JSON.stringify(snapshot(c.sessionId)));ws.send(JSON.stringify(sessionState(c.sessionId)));if(busy){ws.send(JSON.stringify({type:"response",id:c.id,error:{code:"session_busy"}}));return;}}if(c.type==="session.create"){result={sessionId:"new",requestId:"request-new"};sessions.push({...sessions[0],id:"new",title:c.text,cwd:c.project?"/project":"/workspace"});ws.send(JSON.stringify(snapshot("new")));ws.send(JSON.stringify(changed()));}if(c.type==="preferences.set"){preferences=c.preferences;ws.send(JSON.stringify(changed()));}if(c.type==="session.pin"){pinned=[...new Set([...pinned,c.sessionId])];ws.send(JSON.stringify(changed()));}if(c.type==="session.unpin"){pinned=pinned.filter(id=>id!==c.sessionId);ws.send(JSON.stringify(changed()));}if(c.type==="abort")result={inputs:[{requestId:"queued",prompt:"Queued draft",images:[{data:"abcd",mimeType:"image/png",name:"queued.png"}]}]};if(c.type==="session.set_permission_mode"){mode=c.mode;ws.send(JSON.stringify(sessionState(c.sessionId)));}if(c.type==="session.set_model"){thinking=c.thinkingLevel??"off";ws.send(JSON.stringify(sessionState(c.sessionId)));}if(c.type==="project.add")result={id:"added",name:"Added",path:c.path};if(hold)responses.push({ws,message:{type:"response",id:c.id,result}});else ws.send(JSON.stringify({type:"response",id:c.id,result}));}}});
console.log(JSON.stringify({port:server.port,token:"scripted"}));
`;
  const child = spawn("bun", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(child, "exit");
  const connection = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    child.once("error", reject);
    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      if (output.includes("\n")) {
        try {
          resolve(JSON.parse(output));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.once("exit", () => reject(new Error("Wire fixture exited before handshake")));
  });
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
    close: async () => {
      child.kill();
      await exit;
    },
  };
}
