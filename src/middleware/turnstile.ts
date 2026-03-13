import { NextFunction, Request, Response } from 'express'

type TurnstileVerifyResponse = {
    success: boolean
    action?: string
    hostname?: string
    'error-codes'?: string[]
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_EXPECTED_ACTION = 'public_registration'

function getExpectedHostname(): string | null {
    if (process.env.CLOUDFLARE_TURNSTILE_EXPECTED_HOSTNAME) {
        return process.env.CLOUDFLARE_TURNSTILE_EXPECTED_HOSTNAME.trim().toLowerCase()
    }

    const frontendOrigin = process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL
    if (!frontendOrigin) return null

    const firstOrigin = frontendOrigin.split(',')[0]?.trim()
    if (!firstOrigin) return null

    try {
        return new URL(firstOrigin).hostname.toLowerCase()
    } catch {
        return null
    }
}

function getRemoteIp(req: Request): string | undefined {
    const forwardedFor = req.headers['x-forwarded-for']
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim()
    }
    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
        return forwardedFor[0].split(',')[0].trim()
    }

    return req.ip || undefined
}

export async function verifyTurnstileToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY?.trim()
    const expectedHostname = getExpectedHostname()
    const turnstileToken = typeof req.body?.turnstileToken === 'string'
        ? req.body.turnstileToken.trim()
        : ''

    if (!secretKey) {
        res.status(500).json({
            success: false,
            message: 'Turnstile secret key is not configured on the server.',
        })
        return
    }

    if (!expectedHostname) {
        res.status(500).json({
            success: false,
            message: 'Turnstile expected hostname is not configured on the server.',
        })
        return
    }

    if (!turnstileToken) {
        res.status(400).json({
            success: false,
            message: 'Cloudflare verification failed. Please retry.',
        })
        return
    }

    const payload = new URLSearchParams({
        secret: secretKey,
        response: turnstileToken,
    })

    const remoteIp = getRemoteIp(req)
    if (remoteIp) {
        payload.append('remoteip', remoteIp)
    }

    try {
        const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: payload,
        })

        if (!response.ok) {
            res.status(403).json({
                success: false,
                message: 'Cloudflare verification failed. Please retry.',
            })
            return
        }

        const verification = (await response.json()) as TurnstileVerifyResponse

        const isValid = verification.success === true
            && verification.action === TURNSTILE_EXPECTED_ACTION
            && verification.hostname?.toLowerCase() === expectedHostname

        if (!isValid) {
            res.status(403).json({
                success: false,
                message: 'Cloudflare verification failed. Please retry.',
            })
            return
        }

        next()
    } catch (error) {
        console.error('[verifyTurnstileToken] Turnstile verification request failed:', error)
        res.status(403).json({
            success: false,
            message: 'Cloudflare verification failed. Please retry.',
        })
    }
}