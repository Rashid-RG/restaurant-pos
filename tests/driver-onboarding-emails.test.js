import {describe,it,expect} from 'vitest';
import {riderEmailTemplate} from '../lib/driver-onboarding-emails.js';

describe('GastroDriver automatic recruitment and verification email privacy',()=>{
 it.each(['submitted','manager_pending','resubmit','manual_approved','manual_rejected','approved','rejected'])('provides a privacy-safe %s notification',event=>{
  const msg=riderEmailTemplate({event,restaurant:'Sample Restaurant',rider:'Sample Rider'});
  expect(msg.subject).toContain('Sample Restaurant');
  expect(msg.html).toContain('Sample Restaurant');
  expect(msg.text).toContain('RS Technologies');
  expect(msg.html).not.toContain('data:image/');
  expect(msg.text).not.toContain('verification code');
  expect(msg.html).not.toContain('?invite=');
  expect(msg.html).not.toContain('idNumber');
 });
 it('escapes untrusted rider and restaurant names in HTML',()=>{
  const msg=riderEmailTemplate({event:'submitted',restaurant:'<img src=x onerror=evil()>',rider:'<script>danger</script>'});
  expect(msg.html).not.toContain('<script>');
  expect(msg.html).not.toContain('<img src=x');
  expect(msg.html).toContain('&lt;script&gt;');
  expect(msg.html).toContain('&lt;img');
 });
 it('cannot be used for arbitrary email content injection',()=>{
  expect(()=>riderEmailTemplate({event:'arbitrary',restaurant:'test'})).toThrow();
 });
});
