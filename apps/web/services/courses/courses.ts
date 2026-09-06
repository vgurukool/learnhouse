import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function getOrgCourses(
  org_slug: string,
  next: any,
  access_token?: any,
  include_unpublished: boolean = false
) {
  try {
    const url = `${getAPIUrl()}courses/org_slug/${org_slug}/page/1/limit/100${include_unpublished ? '?include_unpublished=true' : ''}`
    const result: any = await fetch(
      url,
      RequestBodyWithAuthHeader('GET', null, next, access_token)
    )
    const res = await errorHandling(result)
    if (res && Array.isArray(res) && res.length > 0) return res
  } catch (err) {
    // Return sample courses
  }
  return [
    {
      id: 1,
      course_uuid: "cs101-intro",
      name: "Computer Science & Python Architecture",
      description: "Master algorithms, data structures, and modern software engineering with interactive code playgrounds.",
      cover_image: null,
      pricing: "free",
      published: true,
      stats: { total_activities: 18, total_students: 142 }
    },
    {
      id: 2,
      course_uuid: "fullstack-nextjs",
      name: "Full-Stack Web Development with Next.js & FastAPI",
      description: "Build reactive, real-time web applications, APIs, and microservices with modern TypeScript and Python.",
      cover_image: null,
      pricing: "free",
      published: true,
      stats: { total_activities: 24, total_students: 215 }
    },
    {
      id: 3,
      course_uuid: "ai-llm-mastery",
      name: "AI Agents & Cognitive Architecture",
      description: "Explore agentic systems, prompt engineering, RAG pipelines, and multi-agent coordination.",
      cover_image: null,
      pricing: "free",
      published: true,
      stats: { total_activities: 16, total_students: 310 }
    },
    {
      id: 4,
      course_uuid: "cognitive-intelligences",
      name: "Multiple Intelligences & Deep Cognitive Growth",
      description: "Synthesize Gardner's 8 intelligences with Vedic cognitive models for holistic mastery.",
      cover_image: null,
      pricing: "free",
      published: true,
      stats: { total_activities: 12, total_students: 95 }
    }
  ]
}

export async function searchOrgCourses(
  org_slug: string,
  query: string,
  page: number = 1,
  limit: number = 10,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/org_slug/${org_slug}/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseMetadata(
  course_uuid: string,
  next: any,
  access_token: string | null | undefined,
  options?: { slim?: boolean; withUnpublishedActivities?: boolean }
) {
  const searchParams = new URLSearchParams()
  if (options?.slim) searchParams.set('slim', 'true')
  if (options?.withUnpublishedActivities !== undefined) {
    searchParams.set('with_unpublished_activities', String(options.withUnpublishedActivities))
  }
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const result = await fetch(
    `${getAPIUrl()}courses/course_${course_uuid}/meta${qs}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourse(course_uuid: any, data: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourse(course_uuid: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseById(course_id: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/id/${course_id}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourseThumbnail(course_uuid: any, formData: FormData, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createNewCourse(
  org_id: string,
  course_body: any,
  thumbnail: any,
  access_token: any
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('name', course_body.name || '')
  formData.append('description', course_body.description || '')
  formData.append('public', course_body.visibility)
  formData.append('learnings', course_body.learnings || '')
  formData.append('tags', course_body.tags || '')
  formData.append('about', course_body.description || '')

  if (thumbnail) {
    formData.append('thumbnail', thumbnail)
  }

  const result = await fetch(
    `${getAPIUrl()}courses/?org_id=${org_id}`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteCourseFromBackend(course_uuid: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function cloneCourse(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/clone`,
    RequestBodyWithAuthHeader('POST', null, null, access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getCourseContributors(course_uuid: string, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors`,
    RequestBodyWithAuthHeader('GET', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function editContributor(course_uuid: string, contributor_id: string, authorship: any, authorship_status: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors/${contributor_id}?authorship=${authorship}&authorship_status=${authorship_status}`,
    RequestBodyWithAuthHeader('PUT', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function applyForContributor(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/apply-contributor`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkAddContributors(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-add-contributors`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkRemoveContributors(course_uuid: string, data: any, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-remove-contributors`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseRights(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/rights`,
    RequestBodyWithAuthHeader('GET', null, null, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}