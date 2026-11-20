import React from 'react';
import { platformPublisher } from '../../../../shared/platform-brand.js';

export default function LegalPoliciesView({ store, onBack, onSupport }) {
  return (
    <article className="ordering-help">
      <button type="button" className="btn btn-ghost" onClick={onBack}>Back to menu</button>
      <h1>Ordering help</h1>
      {store?.name && <p>Restaurant · <strong>{store.name}</strong></p>}
      <section>
        <h2>Prices and payments</h2>
        <p>Review your items, discounts, service charge, tax and delivery fee at checkout. Select one of the payment methods offered for your order.</p>
      </section>
      <section>
        <h2>Pickup and delivery</h2>
        <p>Choose your restaurant and enter your delivery location to check availability. Your order confirmation includes a reference you can use to follow its progress.</p>
      </section>
      <section>
        <h2>Order changes and refunds</h2>
        <p>Contact support with your order reference and the item or amount you need help with. Include whether you paid or are waiting to pay.</p>
      </section>
      <section>
        <h2>Account and privacy questions</h2>
        <p>Use support for questions about your account, saved address or order history. Keep your password and verification codes private.</p>
        <button type="button" className="btn btn-brand" onClick={onSupport}>Contact support</button>
      </section>
      <footer>GastroFlow Food · {platformPublisher}</footer>
    </article>
  );
}
