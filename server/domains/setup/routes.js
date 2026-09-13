'use strict';

const express = require('express');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncHandler, createError } = require('../../utils/errorHandler');
const {
  SETUP_INVALID_PAYLOAD_CODE,
  SETUP_TEST_FAILED_CODE,
  toShortReason,
  runProbe,
} = require('../../infrastructure/backendProbe');
const { computeSetupStatus } = require('../../infrastructure/setupStatus');
const { getSharedResolver } = require('../../infrastructure/configResolver');
const { applySetup } = require('./setupCore');

// Thin HTTP shell over the shared apply core: payload validation, env building,
// T0/DB partition and the write orchestration live in setupCore.js, which the
// first-run CLI setup tool also consumes (docs/features/setup-cli.md).
// The wizard prefills from GET /status only; the former POST /prefill direct
// PG reads were retired as dead code.

async function requireSetupIncomplete(req, res, next) {
  try {
    const effective = await getSharedResolver().getEffectiveConfig();
    const { setup_complete } = computeSetupStatus(process.env, { effectiveConfig: effective });
    if (setup_complete) {
      return next(createError(SERVER_ERROR_CODES.setup.complete, HTTP_STATUS.FORBIDDEN));
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

const router = express.Router();

// GET /api/setup/status — public, always available.
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const effective = await getSharedResolver().getEffectiveConfig();
    const status = computeSetupStatus(process.env, { effectiveConfig: effective });

    res.json(status);
  })
);

// POST /api/setup/test — public; 403 setup.complete when already complete.
router.post(
  '/test',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const result = await runProbe(body.target, body);
      res.json(result);
    } catch (error) {
      const status = error.status || error.statusCode || HTTP_STATUS.BAD_REQUEST;
      const message =
        error.message && error.message !== error.errorCode
          ? error.message
          : 'Connection test failed';
      const reason = toShortReason(error.reason || (error.params && error.params.reason));
      res.status(status).json({
        ok: false,
        errorCode: error.errorCode || SETUP_TEST_FAILED_CODE,
        message,
        ...(reason ? { reason } : {}),
      });
    }
  })
);

// POST /api/setup/apply — public; 403 when already complete.
// Orchestration (validation → .env → admin password → DB settings → cache
// invalidate) lives in setupCore.applySetup.
router.post(
  '/apply',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    try {
      res.json(await applySetup(req.body));
    } catch (error) {
      // Invalid payloads are returned as the same 400 { errorCode, message,
      // fields } body the wizard always produced; genuine write errors keep
      // bubbling to the error handler.
      if (error.errorCode === SETUP_INVALID_PAYLOAD_CODE) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ errorCode: error.errorCode, message: error.message, fields: error.fields });
      }
      throw error;
    }
  })
);

module.exports = router;
