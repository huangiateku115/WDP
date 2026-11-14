import { useEffect, useState } from 'react';
import InventoryOverview from '@/components/common/InventoryOverview';
import { useCustomerData } from '@/lib/customerDemoStore';
import inventoryApi from '@/api/inventoryApi';
import { PackageOpen } from 'lucide-react';
import {Card,CardContent} from '@/components/ui/card';

const USE_BACKEND = import.meta.env.VITE_USE_MOCK !== 'true';
const unwrapItems = response => {
 const body = response?.data;
 if (Array.isArray(body?.data)) return body.data;
 if (Array.isArray(body?.data?.data)) return body.data.data;
 if (Array.isArray(body)) return body;
 return [];
};

function OwnedInventory(){
 const [items,setItems]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 useEffect(()=>{let active=true;inventoryApi.getMine().then(response=>{if(active)setItems(unwrapItems(response));}).catch(reason=>{if(active)setError(reason.response?.data?.message||'Could not load your inventory.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 if(loading)return <p className="mt-6 text-sm text-slate-500">Loading your inventory…</p>;
 if(error)return <p role="alert" className="mt-6 text-sm text-rose-700">{error}</p>;
 return <section className="mt-6"><h2 className="mb-3 text-xl font-semibold">Registered items</h2>{items.length?<Card><div className="customer-table-scroll"><table className="customer-table"><thead><tr>{['Item','Quantity','Total volume','Status','Location'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{items.map(item=><tr key={item._id}><td><b>{item.name}</b><div className="mt-1 text-xs text-slate-500">{item.itemCode} · {item.category}</div></td><td>{item.quantity} {item.quantityUnit}</td><td>{Number(item.totalVolumeM3).toFixed(3)} m³</td><td>{item.status}</td><td>{item.currentCellId||'Not assigned'}</td></tr>)}</tbody></table></div></Card>:<Card><CardContent className="py-10 text-center"><PackageOpen className="mx-auto mb-3 text-sky-700"/><h3 className="font-semibold">No registered items yet</h3><p className="mt-2 text-sm text-slate-500">Items you register for your Managed Inventory rentals will appear here.</p></CardContent></Card>}</section>;
}

function MyInventoryPage(){const {items}=useCustomerData();return <div className="mx-auto max-w-6xl p-5 md:p-8 customer-screen"><span className="label text-sky-700">STORAGE ORGANIZATION</span><h1 className="mt-2 text-4xl font-bold">My Inventory</h1><p className="mt-3 text-slate-500">Keep an overview of the belongings in your storage space.</p>{USE_BACKEND?<OwnedInventory/>:<><InventoryOverview/>{!items.length && <Card className="mt-6"><CardContent className="py-16 text-center"><div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-2xl bg-blue-50 text-sky-700"><PackageOpen size={36}/></div><h2 className="text-xl font-bold">Your inventory workspace</h2><p className="mx-auto mt-3 max-w-md text-sm text-slate-500">Inventory management is ready for API integration.</p></CardContent></Card>}</>}</div>}


export {InventoryListIntegration as default} from '@/components/customer/inventory/InventoryIntegration';
