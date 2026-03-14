import { Request, Response } from 'express'
import { AuthRequest } from '../middleware/auth'
import { prisma } from '../config/db'
import { buildCompetitionCategoryMap } from '../utils/competitionsCsv'

// Fixed venues list (seeded in DB)
export const LAB_VENUES = ['LAB 1', 'LAB 2', 'LAB 3', 'LAB 4', 'LAB 5', 'LAB 6']

// GET /competitions — list all competitions

export async function listCompetitions(_req: AuthRequest, res: Response): Promise<void> {
    const competitions = await prisma.competition.findMany({
        include: {
            venues: { select: { name: true } },
            _count:  { select: { teams: true } },
        },
        orderBy: [{ compDay: 'asc' }, { startTime: 'asc' }],
    })

    res.json({
        success: true,
        data: competitions.map((c) => ({
            id:                   c.id,
            name:                 c.name,
            description:          c.description ?? null,
            venues:               c.venues.map((v) => v.name),
            fee:                  Number(c.fee),
            minTeamSize:          c.minTeamSize,
            maxTeamSize:          c.maxTeamSize,
            capacityLimit:        c.capacityLimit,
            registeredTeams:      c._count.teams,
            compDay:              c.compDay.toISOString(),
            startTime:            c.startTime.toISOString(),
            endTime:              c.endTime.toISOString(),
            isActive:             c.isActive,
            registrationDeadline: c.registrationDeadline?.toISOString() ?? null,
        })),
    })
}

// GET /competitions/public — list competitions with category (no auth)

let cachedCategoryMap: Map<string, string> | null = null

function getCategoryMap(): Map<string, string> {
    if (!cachedCategoryMap) {
        cachedCategoryMap = buildCompetitionCategoryMap()
    }
    return cachedCategoryMap
}

export async function listCompetitionsWithCategory(_req: Request, res: Response): Promise<void> {
    const competitions = await prisma.competition.findMany({
        orderBy: [{ name: 'asc' }],
    })

    // const categoryMap = getCategoryMap()
    res.json({
        success: true,
        data: competitions.map((c) => ({
            id:          c.id,
            name:        c.name,
            category:    String(c.category ?? ''),
            description: c.description ?? null,
            fee:         Number(c.fee),
            capacityLimit: c.capacityLimit,
            earlyBirdFee:   Number(c.earlyBirdFee),
            earlyBirdLimit: c.earlyBirdLimit,
            minTeamSize: c.minTeamSize,
            maxTeamSize: c.maxTeamSize,
            startTime: c.startTime ? c.startTime.toISOString() : null,
            endTime: c.endTime ? c.endTime.toISOString() : null,
        })),
    })
}

// GET /competitions/public/:id — public competition detail (no auth)

export async function getPublicCompetitionById(req: Request, res: Response): Promise<void> {
    const id = String(req.params.id)

    try {
        const competition = await prisma.competition.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                category: true,
                description: true,
                fee: true,
                capacityLimit: true,
                earlyBirdFee: true,
                earlyBirdLimit: true,
                minTeamSize: true,
                maxTeamSize: true,
                startTime: true,
                endTime: true,
            },
        })

        if (!competition) {
            res.status(404).json({ success: false, message: 'Competition not found.' })
            return
        }

        res.json({
            success: true,
            data: {
                id: competition.id,
                name: competition.name,
                category: String(competition.category ?? ''),
                description: competition.description ?? null,
                fee: Number(competition.fee),
                capacityLimit: competition.capacityLimit,
                earlyBirdFee: Number(competition.earlyBirdFee),
                earlyBirdLimit: competition.earlyBirdLimit,
                minTeamSize: competition.minTeamSize,
                maxTeamSize: competition.maxTeamSize,
                startTime: competition.startTime ? competition.startTime.toISOString() : null,
                endTime: competition.endTime ? competition.endTime.toISOString() : null,
            },
        })
    } catch (error: any) {
        const message = error?.message || 'Failed to fetch competition.'
        res.status(500).json({ success: false, message })
    }
}

// PATCH /competitions/:id/time — update start/end time

export async function updateCompetitionTime(req: AuthRequest, res: Response): Promise<void> {
    const id = String(req.params.id)
    const { startTime, endTime } = req.body as { startTime: string; endTime: string }

    const competition = await prisma.competition.findUnique({ where: { id } })
    if (!competition) {
        res.status(404).json({ success: false, message: 'Competition not found.' })
        return
    }

    const start = new Date(startTime)
    const end   = new Date(endTime)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ success: false, message: 'Invalid date format for startTime or endTime.' })
        return
    }
    if (end <= start) {
        res.status(400).json({ success: false, message: 'endTime must be after startTime.' })
        return
    }

    const updated = await prisma.competition.update({
        where: { id },
        data:  { startTime: start, endTime: end },
    })

    res.json({
        success: true,
        message: 'Competition time updated successfully.',
        data: { id: updated.id, name: updated.name, startTime: updated.startTime.toISOString(), endTime: updated.endTime.toISOString() },
    })
}

// PUT /competitions/:id/venues — replace all venues for a competition

export async function updateCompetitionVenues(req: AuthRequest, res: Response): Promise<void> {
    const id = String(req.params.id)
    const { venues } = req.body as { venues: string[] }

    const competition = await prisma.competition.findUnique({ where: { id } })
    if (!competition) {
        res.status(404).json({ success: false, message: 'Competition not found.' })
        return
    }

    // Validate that all requested names are in the known labs list
    const invalid = venues.filter((v) => !LAB_VENUES.includes(v))
    if (invalid.length > 0) {
        res.status(400).json({ success: false, message: `Unknown venues: ${invalid.join(', ')}` })
        return
    }

    // Resolve names to IDs
    const venueRecords = await prisma.venue.findMany({
        where:  { name: { in: venues } },
        select: { id: true, name: true },
    })

    const updated = await prisma.competition.update({
        where:   { id },
        data:    { venues: { set: venueRecords.map((v) => ({ id: v.id })) } },
        include: { venues: { select: { name: true } } },
    })

    res.json({
        success: true,
        message: 'Competition venues updated successfully.',
        data: { id: updated.id, name: updated.name, venues: updated.venues.map((v) => v.name) },
    })
}
