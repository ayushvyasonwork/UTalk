'use client'
import { SocketProvider } from "./context/socketContext";
function Providers({ children }) {
  return (
    <SocketProvider>{children}</SocketProvider>
  );
}
export default Providers;