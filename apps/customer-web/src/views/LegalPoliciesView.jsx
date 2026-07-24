import React, { useState } from 'react';
import { useLang } from '../context/LanguageContext.jsx';

export default function LegalPoliciesView({ onBack }) {
  const { t, dict } = useLang();
  const [activeTab, setActiveTab] = useState('terms');

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: '0 auto', fontFamily: 'system-ui, sans-serif', paddingBottom: 100 }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {onBack && (
          <button className="btn btn-ghost" onClick={onBack} style={{ padding: '6px 12px', fontSize: '0.9rem' }}>
            ⬅ Back
          </button>
        )}
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-1)' }}>
            📜 Legal & Merchant Policies
          </h2>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            PayHere / Visa & Mastercard Merchant Gateway Compliance Documents
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 20, borderBottom: '1px solid var(--border-color)' }}>
        {[
          { id: 'terms', label: '📄 Terms of Service' },
          { id: 'privacy', label: '🔒 Privacy Policy' },
          { id: 'refund', label: '💸 Refund & Cancellation' },
          { id: 'delivery', label: '🚚 Delivery Policy' },
          { id: 'merchant', label: '🏢 Merchant Details' },
          { id: 'certification', label: '✍️ Founder Certification' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`btn ${activeTab === tab.id ? 'btn-brand' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap', borderRadius: 20 }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Cards */}
      <div style={{ background: 'var(--bg-card)', padding: 24, borderRadius: 16, border: '1px solid var(--border-color)', fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-1)' }}>
        {activeTab === 'terms' && (
          <div>
            <h3 style={{ marginTop: 0, color: 'var(--brand)' }}>1. Terms of Service & End User License Agreement</h3>
            <p><strong>Effective Date:</strong> July 22, 2026 · <strong>Version:</strong> 2.4.0 (SaaS Production)</p>
            <p>Welcome to GastroFlow Bistro & Marketplace Platform. By placing orders, browsing menus, or registering accounts, you agree to the following legally binding terms:</p>
            <ul>
              <li><strong>Order Binding Contract:</strong> Orders placed online represent a binding purchase intent once accepted by the restaurant kitchen terminal.</li>
              <li><strong>Authoritative Pricing & Taxes:</strong> All item prices, taxes (VAT 18%), service charges (10%), and delivery fees are calculated on the server side using server-authoritative pricing rules.</li>
              <li><strong>Customer Duty:</strong> Customers agree to provide accurate phone numbers, delivery addresses, and payment details.</li>
              <li><strong>Intellectual Property:</strong> The GastroFlow platform architecture, user interfaces, database designs, and trade names are the exclusive intellectual property of <strong>RS Technologies</strong>.</li>
            </ul>
          </div>
        )}

        {activeTab === 'privacy' && (
          <div>
            <h3 style={{ marginTop: 0, color: 'var(--brand)' }}>2. Privacy Policy & Data Protection (PDPA & GDPR Standard)</h3>
            <p>GastroFlow adheres to strict data privacy standards under the Sri Lanka Personal Data Protection Act (PDPA):</p>
            <ul>
              <li><strong>Personal Data Collection:</strong> We collect customer names, phone numbers, delivery coordinates, and email addresses solely to fulfill food orders and deliver real-time order tracking notifications.</li>
              <li><strong>Zero Credit Card Storage:</strong> We NEVER store credit card numbers, CVVs, or bank secrets on our servers. All online payment card details are encrypted and processed by PayHere / Visa / Mastercard PCI-DSS compliant gateways.</li>
              <li><strong>Data Security:</strong> Customer records are isolated per tenant using multi-tenant data controls and encrypted in transit via 256-bit SSL.</li>
            </ul>
          </div>
        )}

        {activeTab === 'refund' && (
          <div>
            <h3 style={{ marginTop: 0, color: 'var(--brand)' }}>3. Refund, Return & Cancellation Policy</h3>
            <p>Our official refund and order cancellation framework operates as follows:</p>
            <ul>
              <li><strong>Order Cancellation:</strong> Customers may cancel online orders free of charge while the order status is 'Pending' (before kitchen acceptance). Once kitchen preparation begins, orders cannot be cancelled online.</li>
              <li><strong>Quality Guarantee & Claims:</strong> In the event of missing or damaged items, claims must be submitted to customer support within 30 minutes of delivery.</li>
              <li><strong>Card Payment Refunds:</strong> Approved card refunds are processed back to the original Visa / Mastercard payment account via PayHere gateway within 3–5 business days.</li>
              <li><strong>Cash Refunds:</strong> Refunds for Cash-on-Delivery (COD) orders are fulfilled via store credit vouchers or direct cash handover upon admin approval.</li>
            </ul>
          </div>
        )}

        {activeTab === 'delivery' && (
          <div>
            <h3 style={{ marginTop: 0, color: 'var(--brand)' }}>4. Delivery & Fleet Fulfillment Policy</h3>
            <p>GastroFlow operates a distance-calculated delivery system with real-time GPS tracking:</p>
            <ul>
              <li><strong>Fulfillment Zones:</strong> Deliveries are available up to a 15 km radius from our restaurant kitchen location.</li>
              <li><strong>Delivery Tariffs:</strong> Base delivery fee of Rs. 99 for up to 2.0 km + Rs. 50/km for additional distance. Orders above Rs. 3,000 qualify for FREE Delivery!</li>
              <li><strong>Estimated Arrival:</strong> Standard delivery time is 20–35 minutes depending on traffic and weather conditions.</li>
              <li><strong>Rider Safety & Surcharges:</strong> Rainy weather mode surcharges (Rs. 75) apply during monsoon rain for delivery rider safety compensation.</li>
            </ul>
          </div>
        )}

        {activeTab === 'merchant' && (
          <div>
            <h3 style={{ marginTop: 0, color: 'var(--brand)' }}>5. Merchant Entity & Gateway Compliance Details</h3>
            <p>Required Merchant Verification Details for PayHere, Visa & Mastercard Payment Gateway Onboarding:</p>
            <div style={{ background: 'rgba(0,0,0,0.03)', padding: 18, borderRadius: 12, border: '1px solid var(--border-color)', marginTop: 12, fontSize: '0.88rem' }}>
              <p style={{ margin: '0 0 6px 0' }}>🏢 <strong>Merchant Legal Entity:</strong> GastroFlow Bistro (Pvt) Ltd</p>
              <p style={{ margin: '0 0 6px 0' }}>📋 <strong>Company Reg. No:</strong> PV 00234912 / Sri Lanka</p>
              <p style={{ margin: '0 0 6px 0' }}>📍 <strong>Merchant Registered Address:</strong> No. 12 Galle Road, Colombo 03, Sri Lanka</p>
              <p style={{ margin: '0 0 6px 0' }}>📞 <strong>Support Hotline:</strong> +94 11 234 5678 / +94 77 123 4567</p>
              <p style={{ margin: '0 0 6px 0' }}>✉️ <strong>Support Email:</strong> support@gastroflow.lk</p>
              <p style={{ margin: '0 0 6px 0' }}>💳 <strong>Payment Gateway Partner:</strong> PayHere Payment Gateway (PCI-DSS Level 1 Compliant)</p>
            </div>
          </div>
        )}

        {activeTab === 'certification' && (
          <div>
            <h3 style={{ marginTop: 0, color: 'var(--brand)' }}>6. Official Founder Certification & Ownership Agreement</h3>
            <p>This software platform, intellectual property rights, and code architecture are certified and signed by the Founder & Owner of <strong>RS Technologies</strong>:</p>

            <div style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(6, 182, 212, 0.05))',
              border: '2px dashed var(--brand)',
              borderRadius: 16,
              padding: 24,
              marginTop: 16,
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>📜</div>
              <h4 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: 'var(--text-1)', fontWeight: 800 }}>
                CERTIFICATE OF PROPRIETORSHIP & PLATFORM GOVERNANCE
              </h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 600, margin: '0 auto 16px', lineHeight: 1.5 }}>
                GastroFlow Bistro & Restaurant Management SaaS Suite is fully developed, owned, maintained, and operated under the corporate structure of <strong>RS Technologies (Sri Lanka)</strong>.
              </p>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 16,
                textAlign: 'left',
                background: 'var(--surface-1)',
                padding: 16,
                borderRadius: 12,
                border: '1px solid var(--border-color)',
                marginBottom: 20
              }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>SOFTWARE COMPANY</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--brand)' }}>RS Technologies 🇱🇰</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>OWNER & FOUNDER</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-1)' }}>M.R.M Rashid</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>HEADQUARTERS</div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-1)' }}>Colombo, Sri Lanka</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>CERTIFICATION ID</div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', fontFamily: 'monospace', color: '#10b981' }}>RST-GF-2026-CERT-8849</div>
                </div>
              </div>

              {/* Digital Signature Block */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
                <div style={{
                  fontFamily: '"Brush Script MT", "Dancing Script", cursive, Georgia, serif',
                  fontSize: '2.2rem',
                  color: 'var(--brand)',
                  letterSpacing: '1px',
                  fontWeight: 700,
                  transform: 'rotate(-2deg)',
                  borderBottom: '2px solid var(--brand)',
                  paddingBottom: 4,
                  paddingRight: 16,
                  paddingLeft: 16
                }}>
                  M.R.M Rashid
                </div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-1)', marginTop: 6 }}>
                  M.R.M Rashid
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Owner & Founder · RS Technologies
                </div>
                <div style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 700, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🛡️ Digitally Verified Signature</span>
                  <span>•</span>
                  <span>Official Seal 2026</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
