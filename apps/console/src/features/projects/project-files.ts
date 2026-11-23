import { t } from "../../lib/i18n.ts";
import { projectLimits } from '@orion/contracts';
export const importReasons: Record<string,string> = {
  get path_denied() { return t("隐藏或受保护路径"); }, get path_exists() { return t("路径已存在，不覆盖"); }, get path_depth() { return t("目录层级超过限制"); }, get text_file_limit() { return t("非 UTF-8 文本或超过 32 KiB"); }, get sensitive_tool_content() { return t("包含敏感信息"); }, get project_storage_limit() { return t("超出项目容量或数量限制"); }, get invalid_file() { return t("文件格式不支持"); }, get too_many_files() { return t("选择超过 1000 个文件，请缩小范围"); }, get read_failed() { return t("读取失败，可重新选择"); },
};
const protectedPart=/^(?:\..*|node_modules|credentials?(?:\..*)?|secrets?(?:\..*)?|settings\.json|auth\.json|.*\.(?:pem|key|p12|pfx))$/i;
export async function prepareImport(input:File[],folder:boolean) {
  if(input.length>1000)throw new Error(importReasons.too_many_files);
  const files:{path:string;content:string}[]=[],skipped:{path:string;reason:string}[]=[];let bytes=0;
  for(const file of input){
    const original=folder?file.webkitRelativePath:file.name,rel=folder?original.split('/').slice(1).join('/'):original;
    try{
      if(!rel||rel.split('/').some(p=>!p||protectedPart.test(p))||/[\0\\:]/.test(rel))throw new Error('path_denied');
      if(rel.split('/').length>projectLimits.depth+1)throw new Error('path_depth');
      if(file.size>projectLimits.fileBytes)throw new Error('text_file_limit');
      if(files.length>=projectLimits.files||bytes+file.size>projectLimits.bytes)throw new Error('project_storage_limit');
      const data=await file.arrayBuffer();let content:string;
      try{content=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw new Error('text_file_limit');}
      if(content.includes('\0'))throw new Error('text_file_limit');
      files.push({path:rel,content});bytes+=file.size;
    }catch(error){skipped.push({path:rel||original,reason:error instanceof Error&&importReasons[error.message]?error.message:'read_failed'});}
  }
  return {files,skipped,bytes};
}
/** A small, uncompressed UTF-8 ZIP writer. No private server metadata is exported. */
export function projectZip(files:{path:string;content:string}[],directories:string[]=[]):Uint8Array {
  const encoder=new TextEncoder(),chunks:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
  const crc=(data:Uint8Array)=>{let n=0xffffffff;for(const byte of data){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
  const header=(size:number)=>{const bytes=new Uint8Array(size);return{bytes,view:new DataView(bytes.buffer)};};
  const entries=[...directories.map(path=>({path:path+'/',content:''})),...files];
  for(const file of entries){
    const name=encoder.encode(file.path),data=encoder.encode(file.content),checksum=crc(data),local=header(30),record=header(46);
    local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);local.view.setUint16(12,0x21,true);local.view.setUint32(14,checksum,true);local.view.setUint32(18,data.length,true);local.view.setUint32(22,data.length,true);local.view.setUint16(26,name.length,true);
    record.view.setUint32(0,0x02014b50,true);record.view.setUint16(4,20,true);record.view.setUint16(6,20,true);record.view.setUint16(8,0x800,true);record.view.setUint16(14,0x21,true);record.view.setUint32(16,checksum,true);record.view.setUint32(20,data.length,true);record.view.setUint32(24,data.length,true);record.view.setUint16(28,name.length,true);record.view.setUint32(42,offset,true);
    chunks.push(local.bytes,name,data);central.push(record.bytes,name);offset+=30+name.length+data.length;
  }
  const centralSize=central.reduce((n,c)=>n+c.length,0),end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  const output=new Uint8Array(offset+centralSize+22);let position=0;for(const chunk of [...chunks,...central,end.bytes]){output.set(chunk,position);position+=chunk.length;}return output;
}
