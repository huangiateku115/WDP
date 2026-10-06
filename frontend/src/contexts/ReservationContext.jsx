import { createContext, useContext, useEffect, useState } from "react";

const ReservationContext = createContext(null);
const initialReservation = {
  facility: null,
  serviceType: null,
  storage: null,
  startDate: "",
  durationMonths: 1,
  pricing: { monthlyRate: 0, subtotal: 0, deposit: 0, total: 0 },
};

export function ReservationProvider({ children }) {
  const [contracts, setContracts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('SelfStorage_pendingContracts') || sessionStorage.getItem('SelfStorage_pendingContracts')) || []; }
    catch { return []; }
  });
  useEffect(() => { localStorage.setItem('SelfStorage_pendingContracts', JSON.stringify(contracts)); }, [contracts]);
  useEffect(() => {
    const syncContracts = event => {
      if (event.key !== 'SelfStorage_pendingContracts' || !event.newValue) return;
      try {
        const records = JSON.parse(event.newValue);
        if (Array.isArray(records)) setContracts(records);
      } catch { /* Ignore invalid browser storage values. */ }
    };
    window.addEventListener('storage', syncContracts);
    return () => window.removeEventListener('storage', syncContracts);
  }, []);
  const addContract = (booking) => setContracts(previous => [
    { ...booking, contractStatus: 'AWAITING_SIGNATURE' }, ...previous.filter(item => item.id !== booking.id)
  ]);
  const confirmContract = (id, signed) => setContracts(previous => previous.map(item =>
    item.id === id ? { ...item, contractStatus: 'SIGNED', signedContract: signed } : item
  ));
  const [reservation, setReservation] = useState(() => {
    try {
      return (
        JSON.parse(sessionStorage.getItem("SelfStorage_reservation")) ||
        initialReservation
      );
    } catch {
      return initialReservation;
    }
  });

  useEffect(() => {
    sessionStorage.setItem(
      "SelfStorage_reservation",
      JSON.stringify(reservation),
    );
  }, [reservation]);

  const updateReservation = (data) =>
    setReservation((prev) => ({ ...prev, ...data }));
  const clearReservation = () => {
    setReservation(initialReservation);
    sessionStorage.removeItem("SelfStorage_reservation");
  };

  return (
    <ReservationContext.Provider
      value={{ reservation, updateReservation, clearReservation, contracts, addContract, confirmContract }}
    >
      {children}
    </ReservationContext.Provider>
  );
}

export function useReservation() {
  const context = useContext(ReservationContext);
  if (!context)
    throw new Error("useReservation must be used inside ReservationProvider");
  return context;
}
