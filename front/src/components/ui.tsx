import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ActionCardProps = {
  title: string;
  icon?: LucideIcon;
  tone: 'blue' | 'purple' | 'slate' | 'teal';
  subIcon: ReactNode;
  onClick?: () => void;
};

export const ActionCard = ({ title, icon: Icon, tone, subIcon, onClick }: ActionCardProps) => (
  <button type="button" className={`action-card action-card--${tone}`} onClick={onClick}>
    <span className="action-card__title">{title}</span>

    {Icon ? (
      <span className="action-card__icon" aria-hidden="true">
        <Icon size={72} />
      </span>
    ) : null}

    <span className="action-card__subicon" aria-hidden="true">
      {subIcon}
    </span>
  </button>
);

export type StatRowProps = {
  label: string;
  value: string | number;
  unit?: string;
};

export const StatRow = ({ label, value, unit = '' }: StatRowProps) => (
  <div className="stat-row">
    <span className="stat-row__label">{label}</span>
    <span className="stat-row__value">
      {value} {unit}
    </span>
  </div>
);

export type FieldProps = {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  name?: string;
};

export const Field = ({
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  name,
}: FieldProps) => (
  <label className="field">
    <span className="field__label">{label}</span>
    <input
      className="field__input"
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onBlur?.(e.target.value)}
      placeholder={placeholder}
      name={name}
    />
  </label>
);

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export const Modal = ({ title, children, onClose }: ModalProps) => (
  <div className="modal-backdrop modal--enter" role="presentation" onClick={onClose}>
    <div
      className="modal modal--enter"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal__header">
        <h2 id="modal-title">{title}</h2>
        <button type="button" className="modal__close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      <div className="modal__body">{children}</div>
    </div>
  </div>
);
