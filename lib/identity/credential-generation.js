import crypto from 'node:crypto';

// Retains the established password and PIN generation rules for existing POS
// staff and SaaS restaurant provisioning. The output uses a CSPRNG; callers
// are responsible for password hashing and securely displaying credentials.
export function generateStrongPassword(length = 10) {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const syms = '!@#$%&*';

  let pwd = [
    uppers[crypto.randomInt(uppers.length)],
    lowers[crypto.randomInt(lowers.length)],
    nums[crypto.randomInt(nums.length)],
    syms[crypto.randomInt(syms.length)]
  ];

  const allChars = uppers + lowers + nums + syms;
  for (let i = 4; i < length; i++) {
    pwd.push(allChars[crypto.randomInt(allChars.length)]);
  }

  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join('');
}

export function generateSecurePin(length = 6) {
  let pin = '';
  for (let i = 0; i < length; i++) pin += crypto.randomInt(10).toString();
  return pin;
}
