import { api } from "./api.js"

let academicCache
let academicRequest
let academicController

export async function getAcademicCalendar(force = false) {
  if (force) {
    academicCache = undefined
    academicController?.abort()
    academicRequest = undefined
  }
  if (academicCache) return academicCache
  if (!academicRequest) {
    const controller = new AbortController()
    academicController = controller
    const now = new Date()
    const academicYear = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear()
    const request = api(`/academic-calendar?year=${academicYear}`, { signal: controller.signal })
      .then((result) => (academicCache = {
        schedules: Array.isArray(result) ? result : result?.schedules || [],
      }))
      .finally(() => {
        if (academicController === controller) {
          academicController = undefined
          academicRequest = undefined
        }
      })
    academicRequest = request
  }
  return academicRequest
}
