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
            category:    c.category,
            description: c.description ?? null,
            earlyBirdFee:   c.earlyBirdFee,
            earlyBirdLimit: c.earlyBirdLimit,
            fee:         Number(c.fee),
            minTeamSize: c.minTeamSize,
            maxTeamSize: c.maxTeamSize,
        })),
    })
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
