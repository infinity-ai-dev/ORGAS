import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle, XCircle, Send, RotateCcw } from 'lucide-react';
import { RelatorioStatus } from '@/hooks/useRelatorios';

type ApprovalAction = 'enviar_aprovacao' | 'aprovar' | 'rejeitar' | 'reabrir';

interface ApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: ApprovalAction;
  onConfirm: (comentario: string) => void;
  isPending: boolean;
}

const actionConfig: Record<ApprovalAction, {
  title: string;
  description: string;
  buttonText: string;
  buttonVariant: 'default' | 'destructive' | 'secondary';
  icon: typeof CheckCircle;
  requireComment: boolean;
}> = {
  enviar_aprovacao: {
    title: 'Enviar para Aprovação',
    description: 'O relatório será enviado para um revisor aprovar. Você pode adicionar um comentário opcional.',
    buttonText: 'Enviar',
    buttonVariant: 'default',
    icon: Send,
    requireComment: false,
  },
  aprovar: {
    title: 'Aprovar Relatório',
    description: 'Você está prestes a aprovar este relatório fiscal. Adicione um comentário opcional.',
    buttonText: 'Aprovar',
    buttonVariant: 'default',
    icon: CheckCircle,
    requireComment: false,
  },
  rejeitar: {
    title: 'Rejeitar Relatório',
    description: 'Por favor, informe o motivo da rejeição para que o analista possa fazer as correções necessárias.',
    buttonText: 'Rejeitar',
    buttonVariant: 'destructive',
    icon: XCircle,
    requireComment: true,
  },
  reabrir: {
    title: 'Reabrir para Revisão',
    description: 'O relatório será reaberto como rascunho para novas alterações. Informe o motivo.',
    buttonText: 'Reabrir',
    buttonVariant: 'secondary',
    icon: RotateCcw,
    requireComment: true,
  },
};

export function ApprovalDialog({
  open,
  onOpenChange,
  action,
  onConfirm,
  isPending,
}: ApprovalDialogProps) {
  const [comentario, setComentario] = useState('');
  const config = actionConfig[action];
  const Icon = config.icon;

  const handleConfirm = () => {
    if (config.requireComment && !comentario.trim()) return;
    onConfirm(comentario);
    setComentario('');
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setComentario('');
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {config.title}
          </DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <Label htmlFor="comentario">
            Comentário {config.requireComment ? '*' : '(opcional)'}
          </Label>
          <Textarea
            id="comentario"
            placeholder="Digite seu comentário..."
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={4}
          />
          {config.requireComment && !comentario.trim() && (
            <p className="text-sm text-destructive">
              O comentário é obrigatório para esta ação.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            variant={config.buttonVariant}
            onClick={handleConfirm}
            disabled={isPending || (config.requireComment && !comentario.trim())}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {config.buttonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { ApprovalAction };
