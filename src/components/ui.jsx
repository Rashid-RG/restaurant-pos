import React from 'react';

export function Button({ children, variant = 'primary', size = 'medium', className = '', ...props }) {
  const baseClass = 'btn';
  const variantClass = variant ? `btn-${variant}` : '';
  const sizeClass = size === 'small' ? 'btn-sm' : size === 'large' ? 'btn-lg' : '';
  
  return (
    <button className={`${baseClass} ${variantClass} ${sizeClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function Input({ label, error, className = '', ...props }) {
  return (
    <div className="form-group">
      {label && <label>{label}</label>}
      <input className={`form-input ${error ? 'is-invalid' : ''} ${className}`.trim()} {...props} />
      {error && <span className="error-text" style={{ color: 'var(--color-danger)', fontSize: '12px' }}>{error}</span>}
    </div>
  );
}

export function Badge({ children, type = 'primary', className = '' }) {
  return (
    <span className={`badge badge-${type} ${className}`.trim()}>
      {children}
    </span>
  );
}

export function Modal({ isOpen, onClose, title, children, maxWidth = '500px' }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
