import type { Metadata } from 'next';
import { NewPasswordForm } from './NewPasswordForm';

export const metadata: Metadata = { title: 'Nueva contraseña' };

// Destino del enlace "Olvidé mi contraseña": la sesión ya viene abierta desde /auth/callback.
export default function NuevaClavePage() {
  return <NewPasswordForm />;
}
