'use client';

import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, onUndo, ...props }) => (
        <Toast key={id} {...props}>
          <div className="grid gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {onUndo && (
            <ToastAction altText="Undo" onClick={onUndo}>
              Undo
            </ToastAction>
          )}
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport className="fixed bottom-16 right-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 md:bottom-0 md:max-w-[420px]" />
    </ToastProvider>
  );
}
