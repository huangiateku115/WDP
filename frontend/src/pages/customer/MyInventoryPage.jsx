import InventoryOverview from '@/components/common/InventoryOverview';
import { useCustomerData } from '@/lib/customerDemoStore';
import { PackageOpen } from 'lucide-react';
import {Card,CardContent} from '@/components/ui/card';function MyInventoryPage(){const {items}=useCustomerData();return <div className="mx-auto max-w-6xl p-5 md:p-8 customer-screen"><span className="label text-sky-700">STORAGE ORGANIZATION</span><h1 className="mt-2 text-4xl font-bold">My Inventory</h1><p className="mt-3 text-slate-500">Keep an overview of the belongings in your storage space.</p><InventoryOverview/>{!items.length && <Card className="mt-6"><CardContent className="py-16 text-center"><div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-2xl bg-blue-50 text-sky-700"><PackageOpen size={36}/></div><h2 className="text-xl font-bold">Your inventory workspace</h2><p className="mx-auto mt-3 max-w-md text-sm text-slate-500">Inventory management is ready for API integration.</p></CardContent></Card>}</div>}


export {InventoryListIntegration as default} from '@/components/customer/inventory/InventoryIntegration';
