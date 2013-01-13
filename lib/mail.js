// Copyright Peter Širka, Web Site Design s.r.o. (www.petersirka.sk)
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var net = require('net');
var util = require('util');
var events = require('events');
var dns = require('dns');

var CRLF = '\r\n';

function Mailer() {
	this.isDebug = false;
	this.version = '1.0.0';
};

function resolveMx(domain, callback) {
    dns.resolveMx(domain, function(err, data) {

        if (err) {
            callback(err, data);
            return;
        }

        if (!data || data.length == 0) {
            callback(new Error('Cannot resolve MX of ' + domain));
            return;
        }

        data.sort(function(a, b) {
            return a.priority < b. priority;
        });

        function tryConnect(index) {
            
            if (index >= data.length) {
              callback(new Error('Cannot connect to any SMTP server.'));
              return;  
            }

            var sock = net.createConnection(25, data[index].exchange);

            sock.on('error', function(err) {
                tryConnect(++index);
            });

            sock.on('connect', function() {
                sock.removeAllListeners('error');
                callback(null, sock);
            });
        }

        tryConnect(0);
    });
};

function SMTPSender(socket, addressFrom, addressTo, addressCc, subject, body, userName, userPassword, contentType) {

	userName = userName || '';
	userPassword = userPassword || '';

	this.status = 0;
	this.header = '';
	this.data = '';
	this.command = '';
	this.socket = socket;
	this.socket.setTimeout(15000); // 15 sekúnd
	this.options = { port: 25, contentType: contentType || 'text/html' };

	this.socket.on('data', function(data) {
		
		self.data += data.toString();

		var index = self.data.indexOf('\r\n');
		if (index > 0) {
			self.socket.emit('line', self.data.substring(0, index));
			self.data = '';
		}

	});

	var host = getHostName(addressFrom);
	var message = [];
	var buffer = [];
	var to = [];
	var cc = [];

    message.push('From: ' + addressFrom);

	if (util.isArray(addressTo)) {
		
		addressTo.forEach(function(o) {
			to.push(o);
		});

    	message.push('To: ' + addressTo.join(', '));

	} else {
	   	message.push('To: ' + addressTo);
	   	to.push(addressTo);
	}

	if (addressCc != null) {

		if (util.isArray(addressCc)) {
			addressCc.forEach(function(o) {
				to.push(o);
				cc.push(o);;
			});
		} else if (addressCc.length > 0) {
			addressCc.push(addressCc);
			cc.push(addressCc);
		}
	}

	if (userName.length > 0 && userPassword.length > 0)
		buffer.push('AUTH PLAIN ' + new Buffer(userName + '\0' + userName + '\0' + userPassword, 'utf8').toString('base64'));

	buffer.push('MAIL FROM: <' + addressFrom + '>');

	to.forEach(function(o) {
		buffer.push('RCPT TO: <' + o + '>');
	});

	buffer.push('DATA');
	buffer.push('QUIT');
	buffer.push('');
    
    if (cc.length > 0)
		message.push('Cc:' + cc.join(', '));	

	message.push('Subject: ' + subject);
	message.push('MIME-Version: 1.0');
	message.push('Message-ID: <' + (new Date().getTime() + host) + '>');
	message.push('Content-Type: ' + this.options.contentType + '; charset="utf8"');
	message.push('Content-Transfer-Encoding: base64');

	message.push(CRLF);
	message.push(new Buffer(body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')).toString('base64'));

	this.socket.on('line', function(line) {

		if (module.exports.isDebug)
			console.log('–––>', line);

		var code = parseInt(line.match(/\d+/)[0]);

		switch (code) {

			case 220:
				self.command = /\besmtp\b/i.test(line) ? 'EHLO' : 'HELO';
				write(self.command + ' ' + host);
				break;

            case 221: // BYE
            case 235: // VERIFY
            case 250: // OPERATION
            case 251: // FORWARD

				write(buffer.shift());

	            if (buffer.length === 0)
    	        	module.exports.emit('success', addressFrom, addressTo);

				break;
			
			case 334: // LOGIN
				if (userName.length > 0 && userPassword.length > 0) {
					write(new Buffer(userName + '\0' + userName + '\0' + userPassword).toString('base64'));
					break;
				}
				self.socket.end();
				break;

			case 354:
				write(message.join(CRLF));
				write('');
				write('.');
				break;

			default:
				if (code > 399) {
					self.socket.end();
					module.exports.emit('error', line, addressFrom, addressTo);
				}
				break;

		};
	});

	this.socket.setEncoding('utf8');

	function write(line) {
		self.socket.write(line + '\r\n');
	};

	this.socket.on('timeout', function () {
		module.exports.emit('error', new Error('timeout'), addressFrom, addressTo);
		self.socket.destroy();
	});	

	var self = this;
};

function getHostName(address) {   
    return address.substring(address.indexOf('@') + 1);
};

// ======================================================
// PROTOTYPES
// ======================================================

Mailer.prototype = new events.EventEmitter;
Mailer.prototype.send = function(smtp, addressFrom, addressTo, addressCc, subject, body, userName, userPassword) {
	
	if (smtp === null)
		smtp = getHostName(addressFrom);

	resolveMx(smtp, function(err, socket) {

		if (err) {
			module.exports.emit('error', err);
			return;
		}

		SMTPSender(socket, addressFrom, addressTo, addressCc, subject, body, userName, userPassword);
	});
};

// ======================================================
// EXPORTS
// ======================================================

module.exports = new Mailer();