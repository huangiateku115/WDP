from pathlib import Path
def edit(path,old,new):
 p=Path(path);t=p.read_text(encoding='utf-8-sig');assert old in t,(path,old[:80]);p.write_text(t.replace(old,new),encoding='utf-8')
imports='''import ProfilePage from '@/pages/customer/ProfilePage';
import PaymentHistoryPage from '@/pages/customer/PaymentHistoryPage';
import NotificationsPage from '@/pages/customer/NotificationsPage';
import RentalExtensionPage from '@/pages/customer/RentalExtensionPage';
import RentalAccessPage from '@/pages/customer/RentalAccessPage';
import InventoryRegisterPage from '@/pages/customer/InventoryRegisterPage';
import InventoryDetailPage from '@/pages/customer/InventoryDetailPage';
import InventoryMovementRequestPage from '@/pages/customer/InventoryMovementRequestPage';
import InventoryHistoryPage from '@/pages/customer/InventoryHistoryPage';
import FinancialDetailPage from '@/pages/customer/FinancialDetailPage';
'''
edit('src/routes/AppRoutes.jsx','import Placeholder',imports+'import Placeholder')
edit('src/routes/AppRoutes.jsx','element={<Placeholder title="Invoices & PayOS" />}','element={<PaymentHistoryPage />}')
edit('src/routes/AppRoutes.jsx','        <Route path="support" element={<SupportPage />} />','''        <Route path="profile" element={<ProfilePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="rentals/:id/extend" element={<RentalExtensionPage />} />
        <Route path="rentals/:id/access" element={<RentalAccessPage />} />
        <Route path="inventory/register" element={<InventoryRegisterPage />} />
        <Route path="inventory/:id" element={<InventoryDetailPage />} />
        <Route path="inventory/:id/inbound" element={<InventoryMovementRequestPage type="INBOUND" />} />
        <Route path="inventory/:id/outbound" element={<InventoryMovementRequestPage type="OUTBOUND" />} />
        <Route path="inventory/:id/history" element={<InventoryHistoryPage />} />
        <Route path="refunds/:id" element={<FinancialDetailPage kind="refund" />} />
        <Route path="charges/:id" element={<FinancialDetailPage kind="charge" />} />
        <Route path="support" element={<SupportPage />} />''')
edit('src/layouts/CustomerLayout.jsx','UserCircle} from','UserCircle,PackageOpen,Bell} from')
edit('src/layouts/CustomerLayout.jsx',"['/portal/contracts',FileSignature", "['/portal/inventory',PackageOpen,'My Inventory'],['/portal/contracts',FileSignature")
edit('src/layouts/CustomerLayout.jsx',"['/portal/support',LifeBuoy,'Support']", "['/portal/notifications',Bell,'Notifications'],['/portal/support',LifeBuoy,'Support'],['/portal/profile',UserCircle,'Profile']")
edit('src/layouts/CustomerLayout.jsx','<UserCircle/>','<Link to="/portal/profile" aria-label="My profile"><UserCircle/></Link>')
edit('src/pages/customer/MyInventoryPage.jsx',"import { PackageOpen }", "import InventoryOverview from '@/components/common/InventoryOverview';\nimport { useCustomerData } from '@/lib/customerDemoStore';\nimport { PackageOpen }")
edit('src/pages/customer/MyInventoryPage.jsx','function MyInventoryPage(){return','function MyInventoryPage(){const {items}=useCustomerData();return')
edit('src/pages/customer/MyInventoryPage.jsx','max-w-6xl p-8','max-w-6xl p-5 md:p-8 customer-screen')
edit('src/pages/customer/MyInventoryPage.jsx','<Card className="mt-6">','<InventoryOverview/>{!items.length && <Card className="mt-6">')
edit('src/pages/customer/MyInventoryPage.jsx','</Card></div>','</Card>}</div>')
edit('src/pages/customer/MyStoragePage.jsx','import referenceImages', "import { useNavigate } from 'react-router-dom';\nimport CustomerRentalTools from '@/components/common/CustomerRentalTools';\nimport referenceImages")
edit('src/pages/customer/MyStoragePage.jsx','export default function MyStoragePage() {','export default function MyStoragePage() {\n  const nav = useNavigate();')
edit('src/pages/customer/MyStoragePage.jsx','<Button variant="orange">MANAGE STORAGE</Button>','<Button variant="orange" onClick={()=>nav("/portal/rentals/RNT-SELF-001/access")}>MANAGE STORAGE</Button>')
edit('src/pages/customer/MyStoragePage.jsx','<Button variant="ghost">Extend Rental →</Button>','<Button variant="ghost" onClick={()=>nav("/portal/rentals/RNT-SELF-001/extend")}>Extend Rental →</Button>')
edit('src/pages/customer/MyStoragePage.jsx','<Button variant="ghost">View Contract & Invoices</Button>','<Button variant="ghost" onClick={()=>nav("/portal/payments")}>View Contract & Invoices</Button>')
edit('src/pages/customer/MyStoragePage.jsx','''      </div>
    </div>
  );
}''','''      </div>
      <CustomerRentalTools/>
    </div>
  );
}''')
edit('src/pages/customer/MyStoragePage.jsx','function Portal() {','function Portal() {\n  const nav = useNavigate();')
edit('src/pages/customer/MyStoragePage.jsx','<Button variant="outline" className="border-0','<Button onClick={()=>nav("/portal/rentals/RNT-SELF-001/extend")} variant="outline" className="border-0')
# New extension screen: keep date validation readable.
p=Path('src/pages/customer/RentalExtensionPage.jsx');t=p.read_text(encoding='utf-8');start=t.index('min={endDate(rental.endDate,0)');end=t.index(' value={newEnd}',start);t=t[:start]+'min={rental.endDate}'+t[end:];p.write_text(t,encoding='utf-8')
