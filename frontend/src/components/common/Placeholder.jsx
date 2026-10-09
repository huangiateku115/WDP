import { FileText } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
export default function Placeholder({ title }) {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <span className="label text-sky-700">CLIENT WORKSPACE</span><h1 className="mt-2 text-4xl font-bold">{title}</h1>
      <Card className="mt-6">
        <CardContent className="py-16 text-center"><div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-2xl bg-blue-50 text-sky-700"><FileText size={36}/></div><h2 className="mb-3 text-xl font-bold">Reservation documents</h2><div className="mx-auto max-w-md text-sm text-slate-500">
          This section is connected to the reservation flow. Open a reservation
          to view the detailed screen.
        </div></CardContent>
      </Card>
    </div>
  );
}

