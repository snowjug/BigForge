import { Copy } from 'lucide-react';
import { Button, useToast } from '../../ui';

/** Copies text to the clipboard and says so (or says why not). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      aria-label={`Copy ${label}`}
      icon={<Copy size={13} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast({ title: `${label} copied`, tone: 'success', durationMs: 2500 });
        } catch {
          toast({
            title: 'Could not copy',
            description: 'The browser denied clipboard access.',
            tone: 'warning',
          });
        }
      }}
    />
  );
}
