import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return <SonnerToaster richColors closeButton position="top-center" offset={16} />;
}

export { toast } from "sonner";
