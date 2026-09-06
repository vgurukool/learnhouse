import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getAuthOrgSlug } from '@services/org/orgResolution'
import LoginClient from './login'
import { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Login — LearnHouse Academy',
    robots: { index: false, follow: false },
  }
}

const Login = async () => {
  const orgslug = (await getAuthOrgSlug()) || 'default'

  let org: any = null
  try {
    org = await getOrganizationContextInfo(orgslug, {
      revalidate: 60,
      tags: ['organizations'],
    })
  } catch {
    org = null
  }

  if (!org) {
    org = {
      id: 1,
      org_uuid: "default-org-uuid",
      name: "LearnHouse Academy",
      slug: "default",
      description: "LearnHouse",
      config: { config: { active: true, general: { enabled: true } } }
    }
  }

  return (
    <div>
      <LoginClient org={org} />
    </div>
  )
}

export default Login
