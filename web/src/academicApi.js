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
    const request = api("/academic-calendar", { signal: controller.signal })
      .then((result) => (academicCache = result))
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
