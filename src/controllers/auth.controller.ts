import { Request, Response } from 'express'
import { prisma } from '../config/db'
import { supabaseAdmin, supabasePublic } from '../config/supabase'
import { deriveNuId } from '../utils/nuId'
import { StaffRole, UserType } from '@prisma/client'

//for logout
export async function logoutUser(req: Request, res: Response): Promise<void> {
    const authHeader = req.headers.authorization ?? ''
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!jwt) {
        res.status(400).json({ success: false, message: 'No access token provided.' })
        return
    }

    const { error } = await supabaseAdmin.auth.admin.signOut(jwt, 'global')

    if (error) {
        console.error('[logout] Supabase signOut error:', error.message)
    }

    res.status(200).json({ success: true, message: 'Logged out successfully.' })
}

// for login
export async function loginUser(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as { email: string; password: string }

    const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password })

    if (error || !data.session || !data.user) {
        const isInvalid =
            error?.message?.toLowerCase().includes('invalid') ||
            error?.message?.toLowerCase().includes('credentials')

        res.status(isInvalid ? 401 : 500).json({
            success: false,
            message: isInvalid
                ? 'Invalid email or password.'
                : (error?.message ?? 'Login failed. Please try again.'),
        })
        return
    }

    const { session, user: supabaseUser } = data

    // fetch matching prisma User + StaffProfile
    const prismaUser = await prisma.user.findUnique({
        where: { id: supabaseUser.id },
        include: { staffProfile: true },
    })

    if (!prismaUser) {
        res.status(404).json({ success: false, message: 'No account found for this user.' })
        return
    }

    if (!prismaUser.isActive) {
        res.status(403).json({ success: false, message: 'Your account has been deactivated.' })
        return
    }

    // if (prismaUser.staffProfile && !prismaUser.staffProfile.isApproved) {
    //     res.status(403).json({
    //         success: false,
    //         message: 'Your account is pending admin approval.',
    //     })
    //     return
    // }

    // update lastLogin timestamp
    await prisma.user.update({
        where: { id: prismaUser.id },
        data: { lastLogin: new Date() },
    })

    // return session tokens + profile
    res.status(200).json({
        success: true,
        message: 'Login successful.',
        data: {
            accessToken:  session.access_token,
            refreshToken: session.refresh_token,
            expiresIn:    session.expires_in,
            user: {
                id:         prismaUser.id,
                email:      prismaUser.email,
                type:       prismaUser.type,
                nuId:       prismaUser.staffProfile?.nuId       ?? null,
                fullName:   prismaUser.staffProfile?.fullName   ?? null,
                staffRole:  prismaUser.staffProfile?.staffRole  ?? null,
                isApproved: prismaUser.staffProfile?.isApproved ?? null,
            },
        },
    })
}

// for register

// Maps frontend role strings to Prisma StaffRole enum values
const ROLE_MAP: Record<string, StaffRole> = {
    excom:        StaffRole.EXCOM,
    pr:           StaffRole.PR,
    gr:           StaffRole.GR,
    food:         StaffRole.FOOD,
    cs:           StaffRole.COMPETITIONS,
    superadmin:   StaffRole.SUPERADMIN,
}

export async function registerStaff(req: Request, res: Response): Promise<void> {
    const { fullName, email, password, role } = req.body as {
        fullName: string
        email: string
        password: string
        role: string
    }

    // get nuId
    let nuId: string
    try {
        nuId = deriveNuId(email)
    } catch {
        res.status(400).json({ success: false, message: 'Invalid NU email format.' })
        return
    }

    // get role
    const staffRole = ROLE_MAP[role.toLowerCase()]
    if (!staffRole) {
        res.status(400).json({ success: false, message: `Unknown role: "${role}".` })
        return
    }

    // check for duplicate email or nuId in prisma before touching Supabase
    const [existingEmail, existingNuId] = await Promise.all([
        prisma.user.findUnique({ where: { email } }),
        prisma.staffProfile.findUnique({ where: { nuId } }),
    ])

    if (existingEmail) {
        res.status(409).json({ success: false, message: 'An account with this email already exists.' })
        return
    }
    if (existingNuId) {
        res.status(409).json({ success: false, message: 'A staff profile with this NU ID already exists.' })
        return
    }

    // create user in supabase
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        // app_metadata is admin-only — users cannot modify it via the client SDK
        // This is what the Next.js middleware reads for role-based route protection
        app_metadata: {
            role: staffRole,
        },
        // user_metadata is readable by the user but we keep it for convenience
        user_metadata: {
            full_name: fullName,
            role:      staffRole,
            nu_id:     nuId,
        },
    })

    if (authError || !authData.user) {
        console.error('[register] Supabase auth error:', authError)
        if (authError?.message?.toLowerCase().includes('already')) {
            res.status(409).json({ success: false, message: 'An account with this email already exists.' })
        } else {
            res.status(500).json({ success: false, message: authError?.message ?? 'Failed to create auth user.' })
        }
        return
    }

    const supabaseUserId = authData.user.id

    // enter into prisma also using the same UUID so relations stay consistent
    try {
        const user = await prisma.user.create({
            data: {
                id:    supabaseUserId,
                email,
                type:  UserType.STAFF,
                staffProfile: {
                    create: {
                        fullName,
                        nuId,
                        staffRole,
                        isApproved: false,
                    },
                },
            },
            include: { staffProfile: true },
        })

        res.status(201).json({
            success: true,
            message: 'Staff account created successfully.',
            data: {
                id:         user.id,
                email:      user.email,
                nuId:       user.staffProfile!.nuId,
                fullName:   user.staffProfile!.fullName,
                staffRole:  user.staffProfile!.staffRole,
                isApproved: user.staffProfile!.isApproved,
            },
        })
    } catch (prismaError) {
        console.error('[register] Prisma error:', prismaError)

        // rollback ; remove the Supabase auth user so they can retry
        await supabaseAdmin.auth.admin.deleteUser(supabaseUserId)

        res.status(500).json({ success: false, message: 'Registration failed while saving profile. Please try again.' })
    }
}
