/**
 * Minimal WebAuthn browser helpers (no bundler). Used by dashboard.html.
 */
(function (global) {
  'use strict';

  function base64UrlToBuffer(base64url) {
    var padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    var base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function bufferToBase64Url(buffer) {
    var bytes = new Uint8Array(buffer);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeCreationOptions(options) {
    var pub = Object.assign({}, options);
    pub.challenge = base64UrlToBuffer(options.challenge);
    pub.user = Object.assign({}, options.user, {
      id: base64UrlToBuffer(options.user.id),
    });
    if (options.excludeCredentials) {
      pub.excludeCredentials = options.excludeCredentials.map(function (c) {
        return Object.assign({}, c, { id: base64UrlToBuffer(c.id) });
      });
    }
    return pub;
  }

  function decodeRequestOptions(options) {
    var pub = Object.assign({}, options);
    pub.challenge = base64UrlToBuffer(options.challenge);
    if (options.allowCredentials) {
      pub.allowCredentials = options.allowCredentials.map(function (c) {
        return Object.assign({}, c, { id: base64UrlToBuffer(c.id) });
      });
    }
    return pub;
  }

  function serializeCredential(credential) {
    if (credential.response.getPublicKey) {
      return {
        id: credential.id,
        rawId: bufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
          attestationObject: bufferToBase64Url(credential.response.attestationObject),
          transports: credential.response.getTransports ? credential.response.getTransports() : undefined,
        },
        clientExtensionResults: credential.getClientExtensionResults(),
      };
    }
    return {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
        authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
        signature: bufferToBase64Url(credential.response.signature),
        userHandle: credential.response.userHandle
          ? bufferToBase64Url(credential.response.userHandle)
          : undefined,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }

  function supported() {
    return !!(global.window && global.window.PublicKeyCredential && global.navigator && global.navigator.credentials);
  }

  async function registerPasskey(options) {
    if (!supported()) throw new Error('This browser does not support security keys or passkeys.');
    var cred = await global.navigator.credentials.create({
      publicKey: decodeCreationOptions(options),
    });
    return serializeCredential(cred);
  }

  async function authenticatePasskey(options) {
    if (!supported()) throw new Error('This browser does not support security keys or passkeys.');
    var cred = await global.navigator.credentials.get({
      publicKey: decodeRequestOptions(options),
    });
    return serializeCredential(cred);
  }

  global.OmniWebAuthn = {
    supported: supported,
    registerPasskey: registerPasskey,
    authenticatePasskey: authenticatePasskey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
