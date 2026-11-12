import {useEffect,useRef,useState} from 'react';
import {Printer} from 'lucide-react';
import contractApi from '@/api/contractApi';
import {getAccessToken,useAuthSession} from '@/lib/authSession';
import {termsApi} from '@/api/termsApi';
import {contractPrintModel,verifySelfStoragePrintTerms} from '@/lib/contractPrint';
import {Button} from '@/components/ui/button';
import {Dialog} from '@/components/ui/dialog';
import ContractPrintDocument from './ContractPrintDocument';
import printCss from './contract-print.css?raw';

const id=value=>typeof value==='string'?value:value?._id||value?.id;
function printError(error){
  const status=error?.response?.status;
  if(status===401)return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if(status===403||status===404)return 'Không tìm thấy hợp đồng hoặc bạn không có quyền truy cập.';
  if(status>=500||error?.isAxiosError)return 'Không tải được dữ liệu hợp đồng. Vui lòng thử lại.';
  return 'Không thể xác minh dữ liệu hợp đồng để in. Vui lòng tải lại hợp đồng.';
}

export default function ContractPrintAction({contractId,reservationId,v2=false,expectUpfrontSelfStorage=false}){
  const {accessToken,user}=useAuthSession(),[document,setDocument]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const request=useRef(null),busy=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
  useEffect(()=>{request.current?.abort();setDocument(null);setError('');setPending(false);busy.current=false;},[accessToken,contractId,reservationId]);
  if(user?.role!=='CUSTOMER')return null;
  async function open(){
    if(busy.current||!accessToken||getAccessToken()!==accessToken)return;
    busy.current=true;setPending(true);setError('');setDocument(null);
    const controller=new AbortController();request.current=controller;const token=accessToken;
    const current=()=>mounted.current&&!controller.signal.aborted&&getAccessToken()===token;
    try{
      if(!/^[a-f\d]{24}$/i.test(contractId||''))throw Error('Invalid contract ID');
      // Deliberately use the authorized detail endpoint, never /contracts/:id/print.
      const response=await contractApi.detailReal(contractId,{signal:controller.signal});
      if(!current())return;
      if(response?.data?.success!==true)throw Error('Invalid contract response');
      const contract = response.data.data;
      const identity = {contractId,reservationId,customerId:id(user),v2,expectUpfrontSelfStorage};
      let model = contractPrintModel(contract, identity);
      if (model.termsAcceptance?.serviceType === 'SELF_STORAGE' && model.termsAcceptance.versionId) {
        const version = await termsApi.version('SELF_STORAGE', model.termsAcceptance.versionId, {signal:controller.signal})
          .catch(() => null);
        if (!current()) return;
        const verifiedTerms = version?.data?.success === true
          ? await verifySelfStoragePrintTerms(model.termsAcceptance, version.data.data).catch(() => [])
          : [];
        if (verifiedTerms.length) model = contractPrintModel(contract, {...identity,verifiedTerms});
      }
      const {renderToStaticMarkup}=await import('react-dom/server');
      if(!current())return;
      const markup=renderToStaticMarkup(<ContractPrintDocument model={model}/>);
      const html='<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; font-src \'none\'"><title>Hợp đồng lưu trữ</title><style>'+printCss+'</style></head><body>'+markup+'</body></html>';
      setDocument({html,token});
    }catch(e){if(current())setError(printError(e));}
    finally{if(current()){busy.current=false;setPending(false);}}
  }
  return <div className="my-4 space-y-3"><Button variant="outline" disabled={pending||!accessToken} onClick={open}><Printer size={16}/>{pending?'Đang chuẩn bị bản in…':'In hợp đồng / Lưu PDF'}</Button>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{document&&document.token===accessToken&&<PrintPreview html={document.html} token={document.token} onClose={()=>setDocument(null)}/>}</div>;
}

function PrintPreview({html,token,onClose}){
  const frame=useRef(null),automatic=useRef(false),alive=useRef(false),[ready,setReady]=useState(false),[error,setError]=useState('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function print(){
    if(!alive.current||getAccessToken()!==token)return;
    try{
      const target=frame.current;
      if(!target?.contentDocument||!target.contentWindow)throw Error();
      await target.contentDocument.fonts.ready;
      if(!alive.current||getAccessToken()!==token)return;
      target.contentWindow.focus();
      target.contentWindow.print();
    }catch{if(alive.current)setError('Không mở được hộp thoại in. Hãy dùng nút In / Lưu PDF trong cửa sổ này.');}
  }
  function loaded(){
    setReady(true);
    if(automatic.current)return;
    automatic.current=true;
    window.requestAnimationFrame(()=>{if(alive.current)print();});
  }
  return <Dialog title="Bản in hợp đồng A4" description="Chọn máy in hoặc Save as PDF / Lưu dưới dạng PDF trong hộp thoại của trình duyệt. Thao tác này không tự tải file PDF." onClose={onClose}>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">A4 dọc · lề 18 mm · thời gian Việt Nam</p><Button variant="orange" disabled={!ready} onClick={print}><Printer size={16}/>In / Lưu PDF</Button></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <iframe ref={frame} title="Nội dung hợp đồng A4" sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={loaded} className="h-[65vh] min-h-80 w-full rounded-lg border bg-white"/>
  </Dialog>;
}
