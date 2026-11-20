import {describe,it,expect} from 'vitest';
import {riderEmailTemplate,riderOtpEmailTemplate} from '../lib/driver-onboarding-emails.js';

describe('GastroDriver distinct one-time-code email',()=>{
 it('mentions GastroDriver, not GastroFood, and uses private rider wording',()=>{
  const email=riderOtpEmailTemplate({code:'123456',email:'driver@example.com'});
  expect(email.subject).toContain('GastroDriver');
  expect(email.html).toContain('GastroDriver');
  expect(email.html).not.toContain('GastroFood');
  expect(email.text).toContain('123456');
  expect(email.html).toContain('Single use');
  expect(email.html).not.toContain('customer account');
 });
 it('separates recovery wording and rejects unsupported OTP input',()=>{
  const email=riderOtpEmailTemplate({code:'654321',email:'driver@example.com',purpose:'recover'});
  expect(email.subject).toContain('Resume');
  expect(email.text).toContain('resume');
  expect(()=>riderOtpEmailTemplate({code:'abcd',email:'driver@example.com'})).toThrow();
 });
});

describe('GastroDriver automatic recruitment and verification email privacy',()=>{
 it.each(['submitted','manager_pending','resubmit','manual_approved','manual_rejected','approved','rejected'])('provides a privacy-safe %s notification',event=>{
  const msg=riderEmailTemplate({event,restaurant:'Sample Restaurant',rider:'Sample Rider'});
  expect(msg.subject).toContain('Sample Restaurant');
  expect(msg.html).toContain('Sample Restaurant');
  expect(msg.text).toContain('Powered by GastroFlow, RS Orunara.');
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
 it('uses safe actionable resubmission reasons without inserting private free text',()=>{
  const msg=riderEmailTemplate({event:'resubmit',restaurant:'Example Cafe',rider:'Test Rider',reason:'unclear_selfie'});
  expect(msg.text).toContain('Retake it');
  expect(msg.html).toContain('Your selfie is unclear');
  const unknown=riderEmailTemplate({event:'resubmit',restaurant:'Example Cafe',reason:'<script>private data</script>'});
  expect(unknown.html).not.toContain('<script>');
 });
 it('cannot be used for arbitrary email content injection',()=>{
  expect(()=>riderEmailTemplate({event:'arbitrary',restaurant:'test'})).toThrow();
 });
});
