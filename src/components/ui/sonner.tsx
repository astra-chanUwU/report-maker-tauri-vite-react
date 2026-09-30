import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return <SonnerToaster richColors closeButton position="bottom-right" offset={44} />;
}

export { toast } from "sonner";
