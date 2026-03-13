import { Router } from 'express'
import { createPublicRegistration, listPublicRegistrations } from '../controllers/webRegistration.controller'
import { parsePaymentScreenshot, uploadPaymentProof } from '../middleware/uploadPaymentProof'
import { verifyTurnstileToken } from '../middleware/turnstile'

const router = Router()

router.get('/', listPublicRegistrations)

router.post(
    '/',
    parsePaymentScreenshot,
    verifyTurnstileToken,
    uploadPaymentProof,
    createPublicRegistration
)

export default router

