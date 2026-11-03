// nodemailer v10: stesse opzioni usate dall'app (secure:false + auth, from/to/cc/subject/text/html)
// verso un server SMTP finto locale, per verificare che l'aggiornamento non rompa gli invii.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import nodemailer from 'nodemailer';

function fakeSmtp() {
  const received = { auth: null, from: null, rcpt: [], data: '' };
  const server = net.createServer(sock => {
    let buf = '', inData = false;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', chunk => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 OK queued as 42\r\n'); }
          else received.data += line + '\n';
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (cmd === 'AUTH') { received.auth = Buffer.from(line.split(' ')[2] || '', 'base64').toString(); sock.write('235 ok\r\n'); }
        else if (cmd === 'MAIL') { received.from = line; sock.write('250 ok\r\n'); }
        else if (cmd === 'RCPT') { received.rcpt.push(line); sock.write('250 ok\r\n'); }
        else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.end('221 bye\r\n'); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port, received })));
}

test('nodemailer v10 invia con le opzioni dell\'app', async () => {
  const { server, port, received } = await fakeSmtp();
  try {
    const t = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, auth: { user: 'bot@x.it', pass: 'app-pass' } });
    const info = await t.sendMail({
      from: 'Team Hours Tracker <bot@x.it>', to: 'tl@x.it', cc: ['cc1@x.it', 'cc2@x.it'],
      subject: 'Nuova assenza — Mario Rossi', text: 'Testo semplice', html: '<p><b>HTML</b> àèì</p>'
    });
    assert.ok(info.messageId);
    assert.match(info.response, /250 OK queued/);
    assert.deepEqual(info.accepted.sort(), ['cc1@x.it', 'cc2@x.it', 'tl@x.it']);
    assert.equal(received.auth, '\u0000bot@x.it\u0000app-pass');
    assert.equal(received.rcpt.length, 3);
    assert.match(received.data, /Subject: =\?UTF-8\?/);
    assert.match(received.data, /Content-Type: text\/html/);
  } finally { server.close(); }
});
