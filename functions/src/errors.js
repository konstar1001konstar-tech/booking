'use strict';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.httpStatus = status;
    this.code = code;
  }
}

class RepoError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

module.exports = { HttpError, RepoError };
